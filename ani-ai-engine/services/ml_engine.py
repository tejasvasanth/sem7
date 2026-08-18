"""
MLEngine — loads (or lazily trains, if missing) a Random Forest classifier that
predicts P(user has left) from the ContextState features, and scales that
probability to a 0-100 confidence score.

Features (fixed order — must match training/trainer.py):
    idleTime, rssi, phoneMoving, keyboardActive, mouseActive, battery, charging
"""

import os
from typing import Dict, List, Optional

import joblib
import numpy as np

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "rf_model.pkl")

FEATURE_ORDER: List[str] = [
    "idleTime", "rssi", "phoneMoving", "keyboardActive", "mouseActive",
    "battery", "charging",
]


class MLEngine:
    def __init__(self, model_path: str = MODEL_PATH):
        self.model_path = os.path.abspath(model_path)
        self.model = None
        self._load()

    def _load(self):
        if os.path.exists(self.model_path):
            try:
                self.model = joblib.load(self.model_path)
            except Exception as e:
                print(f"[MLEngine] Failed to load model at {self.model_path}: {e}")
                self.model = None
        else:
            print(f"[MLEngine] No model found at {self.model_path}. "
                  f"Run POST /train or training/trainer.py to create one.")

    def reload(self):
        """Call after a training run writes a new .pkl file."""
        self._load()

    def is_ready(self) -> bool:
        return self.model is not None

    @staticmethod
    def _vectorize(ctx: Dict) -> np.ndarray:
        return np.array([[
            ctx["idleTime"],
            ctx["rssi"],
            int(bool(ctx["phoneMoving"])),
            int(bool(ctx["keyboardActive"])),
            int(bool(ctx["mouseActive"])),
            ctx["battery"],
            int(bool(ctx["charging"])),
        ]], dtype=float)

    def predict_confidence(self, ctx: Dict) -> Optional[float]:
        """Returns confidence 0-100 that the user has left, or None if no
        model is loaded (caller should fall back to rule-only)."""
        if self.model is None:
            return None
        x = self._vectorize(ctx)
        proba = self.model.predict_proba(x)[0]
        # class 1 == "user_left"
        classes = list(self.model.classes_)
        p_left = proba[classes.index(1)] if 1 in classes else proba[-1]
        return float(round(p_left * 100, 2))

    def feature_importance(self) -> Dict[str, float]:
        if self.model is None or not hasattr(self.model, "feature_importances_"):
            return {}
        return {
            name: float(round(score, 4))
            for name, score in zip(FEATURE_ORDER, self.model.feature_importances_)
        }
