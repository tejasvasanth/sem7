"""
RuleEngine — the baseline layer of the decision pipeline. Always runs, even if
the ML model or Gemini are unavailable, so the system degrades gracefully.

Rules (fixed order, first match wins), per PERSON_2_AI_ENGINE.md:
    idleTime > 60  AND rssi < -75        -> LOCK   (confidence 95)
    phoneMoving    AND rssi < -70        -> LOCK   (confidence 85)
    keyboardActive OR  mouseActive       -> WAIT   (confidence 90)
    otherwise                            -> WAIT   (confidence 50, passed to ML)
"""

from dataclasses import dataclass
from typing import Dict


@dataclass
class RuleResult:
    decision: str          # "LOCK" | "WAIT"
    confidence: float      # 0-100
    reason: str


class RuleEngine:
    def evaluate(self, ctx: Dict) -> RuleResult:
        idle_time = ctx["idleTime"]
        rssi = ctx["rssi"]
        phone_moving = ctx["phoneMoving"]
        keyboard_active = ctx["keyboardActive"]
        mouse_active = ctx["mouseActive"]

        if idle_time > 60 and rssi < -75:
            return RuleResult(
                decision="LOCK",
                confidence=95,
                reason=f"Idle for {idle_time}s with weak signal ({rssi} dBm) — phone is far away",
            )

        if phone_moving and rssi < -70:
            return RuleResult(
                decision="LOCK",
                confidence=85,
                reason=f"Phone moved away while signal dropped to {rssi} dBm",
            )

        if keyboard_active or mouse_active:
            return RuleResult(
                decision="WAIT",
                confidence=90,
                reason="User is actively typing or using the mouse",
            )

        return RuleResult(
            decision="WAIT",
            confidence=50,
            reason="No hard rule fired — deferring to the ML model",
        )
