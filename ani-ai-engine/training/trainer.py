"""
trainer.py — trains the Random Forest on either:
  1. an explicit CSV path (dataset_path passed to POST /train), or
  2. recorded prediction history from SQLite (once enough real data exists), or
  3. the synthetic cold-start dataset (generated on the fly if neither exists)

Saves the trained model to models/rf_model.pkl and returns accuracy +
feature list, which main.py also writes to the model_metadata table.
"""

import os
import time
from typing import Dict, List, Optional, Tuple

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

from services.database import DatabaseService
from services.ml_engine import FEATURE_ORDER

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
MODEL_PATH = os.path.join(MODEL_DIR, "rf_model.pkl")
COLD_START_CSV = os.path.join(os.path.dirname(__file__), "mock-training-data.csv")

MIN_REAL_ROWS_TO_PREFER_HISTORY = 80  # below this, cold-start synthetic data is more reliable


def _load_from_history(db: DatabaseService) -> Optional[pd.DataFrame]:
    """Builds a labeled training frame from predictions + corrections.
    Label = correction if one exists for that timestamp, else the original
    decision translated to a binary "user_left" label."""
    predictions = db.get_predictions(n=5000)
    if len(predictions) < MIN_REAL_ROWS_TO_PREFER_HISTORY:
        return None

    corrections_by_ts = {}
    for c in db.get_corrections(n=5000):
        corrections_by_ts[c["timestamp"]] = c["correct_decision"]

    rows = []
    for p in predictions:
        decision = corrections_by_ts.get(p["timestamp"], p["decision"])
        user_left = 1 if decision == "LOCK" else 0
        rows.append({
            "idleTime": p["idle_time"],
            "rssi": p["rssi"],
            "phoneMoving": p["phone_moving"],
            "keyboardActive": p["keyboard_active"],
            "mouseActive": p["mouse_active"],
            "battery": p["battery"],
            "charging": p["charging"],
            "user_left": user_left,
        })
    return pd.DataFrame(rows)


def _load_cold_start() -> pd.DataFrame:
    if not os.path.exists(COLD_START_CSV):
        # Generate on the fly if it hasn't been created yet
        from training.generate_dataset import generate
        df = generate()
        df.to_csv(COLD_START_CSV, index=False)
        return df
    return pd.read_csv(COLD_START_CSV)


def load_training_data(dataset_path: Optional[str], db: DatabaseService) -> Tuple[pd.DataFrame, str]:
    if dataset_path:
        return pd.read_csv(dataset_path), f"explicit dataset ({dataset_path})"

    history_df = _load_from_history(db)
    if history_df is not None:
        return history_df, "recorded prediction history"

    return _load_cold_start(), "synthetic cold-start dataset"


def train(dataset_path: Optional[str] = None, db: Optional[DatabaseService] = None) -> Dict:
    db = db or DatabaseService()
    df, source = load_training_data(dataset_path, db)

    X = df[FEATURE_ORDER]
    y = df["user_left"]

    # Guard against a degenerate single-class dataset (can't stratify / not useful)
    if y.nunique() < 2:
        raise ValueError(
            f"Training data from {source} has only one class ({y.unique().tolist()}); "
            "need both LOCK and non-LOCK examples."
        )

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = RandomForestClassifier(
        n_estimators=200, max_depth=10, min_samples_leaf=3, random_state=42, n_jobs=-1
    )
    model.fit(X_train, y_train)

    accuracy = float(round(accuracy_score(y_test, model.predict(X_test)), 4))

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)

    trained_at = int(time.time())
    features: List[str] = FEATURE_ORDER

    db.insert_model_metadata(trained_at=trained_at, accuracy=accuracy, features=features)

    return {
        "accuracy": accuracy,
        "featuresUsed": features,
        "trainedAt": trained_at,
        "trainingRows": len(df),
        "dataSource": source,
    }


if __name__ == "__main__":
    result = train()
    print(result)
