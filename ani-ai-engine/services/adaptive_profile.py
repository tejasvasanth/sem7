"""
AdaptiveProfile — tracks user corrections over time and produces a short
natural-language summary that gets folded into the Gemini prompt, plus
triggers periodic retraining once enough corrections accumulate.
"""

from typing import Dict, List

from .database import DatabaseService

RETRAIN_EVERY_N_CORRECTIONS = 50


class AdaptiveProfile:
    def __init__(self, db: DatabaseService):
        self.db = db

    def record_decision(self, prediction_row: Dict) -> None:
        """Predictions are already written to SQLite by the caller; this hook
        exists so future per-user weighting logic has a single place to live."""
        return

    def record_correction(self, timestamp: int, original_decision: str, correct_decision: str) -> int:
        self.db.insert_correction(timestamp, original_decision, correct_decision)
        return self.db.count_corrections()

    def should_retrain(self) -> bool:
        return self.db.count_corrections() > 0 and self.db.count_corrections() % RETRAIN_EVERY_N_CORRECTIONS == 0

    def summary(self, limit: int = 20) -> str:
        """Human-readable summary of recent corrections, fed into the Gemini
        prompt so it knows the user's recent overrides."""
        corrections: List[Dict] = self.db.get_corrections(n=limit)
        if not corrections:
            return "No corrections recorded yet."

        overrides_to_lock = sum(1 for c in corrections if c["correct_decision"] == "LOCK")
        overrides_to_unlock_or_wait = sum(
            1 for c in corrections if c["correct_decision"] in ("UNLOCK", "WAIT")
        )

        parts = [f"In the last {len(corrections)} corrections:"]
        if overrides_to_lock:
            parts.append(f"{overrides_to_lock} times the user confirmed LOCK was right")
        if overrides_to_unlock_or_wait:
            parts.append(f"{overrides_to_unlock_or_wait} times the user overrode a LOCK back to UNLOCK/WAIT")
        return "; ".join(parts) + "."
