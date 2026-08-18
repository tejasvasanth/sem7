"""
metrics.py — computes system-level metrics for GET /metrics, on top of the
raw SQLite tables that DatabaseService exposes.
"""

import time
from typing import Dict

from services.database import DatabaseService
from services.ml_engine import MLEngine


def compute_metrics(db: DatabaseService, ml_engine: MLEngine) -> Dict:
    total_predictions = db.count_predictions()
    false_lock_rate = db.false_lock_rate()

    latest_meta = db.latest_model_metadata()
    accuracy = latest_meta["accuracy"] if latest_meta else None
    model_trained_at = latest_meta["trained_at"] if latest_meta else None

    now = int(time.time())
    gemini_calls_last_24h = db.count_gemini_calls_since(now - 24 * 3600)

    return {
        "accuracy": accuracy,
        "falseLockRate": false_lock_rate,
        "totalPredictions": total_predictions,
        "modelTrainedAt": model_trained_at,
        "geminiCallsLast24h": gemini_calls_last_24h,
        "featureImportance": ml_engine.feature_importance(),
        "modelReady": ml_engine.is_ready(),
    }
