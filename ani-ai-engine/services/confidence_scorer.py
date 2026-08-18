"""
ConfidenceScorer — blends the rule engine's and ML engine's confidence scores
into a single number, then applies the decision gate.

    blended = rule_confidence * 0.4 + ml_confidence * 0.6

    blended >= 70            -> LOCK
    blended <= 30            -> UNLOCK
    40 < blended < 60        -> band handed to Gemini by the pipeline
    otherwise (30-40, 60-70) -> WAIT (not confident enough either way)
"""

from dataclasses import dataclass

RULE_WEIGHT = 0.4
ML_WEIGHT = 0.6

LOCK_THRESHOLD = 70
UNLOCK_THRESHOLD = 30
GEMINI_BAND = (40, 60)


@dataclass
class GateResult:
    decision: str  # "LOCK" | "UNLOCK" | "WAIT"
    needs_gemini: bool


class ConfidenceScorer:
    def blend(self, rule_confidence: float, ml_confidence: float) -> float:
        return round(rule_confidence * RULE_WEIGHT + ml_confidence * ML_WEIGHT, 2)

    def gate(self, blended_confidence: float) -> GateResult:
        lo, hi = GEMINI_BAND
        if lo < blended_confidence < hi:
            return GateResult(decision="WAIT", needs_gemini=True)
        if blended_confidence >= LOCK_THRESHOLD:
            return GateResult(decision="LOCK", needs_gemini=False)
        if blended_confidence <= UNLOCK_THRESHOLD:
            return GateResult(decision="UNLOCK", needs_gemini=False)
        return GateResult(decision="WAIT", needs_gemini=False)
