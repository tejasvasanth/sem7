"""
AirLock AI Engine — FastAPI entry point (Person 2).

Runs on port 8000, per the God File. Implements the six-stage decision
pipeline documented in PERSON_2_AI_ENGINE.md:

    1. Rule Engine        (services/rule_engine.py)
    2. ML Engine           (services/ml_engine.py)
    3. Confidence blending (services/confidence_scorer.py)
    4. Decision gate       (services/confidence_scorer.py)
    5. Gemini (40-60% band)(services/gemini_client.py)
    6. Adaptive profile update (services/adaptive_profile.py)

Start with:  uvicorn main:app --reload --port 8000
"""

import os
import time
from typing import List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.database import db
from services.rule_engine import RuleEngine
from services.ml_engine import MLEngine
from services.confidence_scorer import ConfidenceScorer
from services.adaptive_profile import AdaptiveProfile
from services.gemini_client import GeminiClient
from services.mqtt_listener import MqttListener
from evaluation.metrics import compute_metrics

app = FastAPI(title="AirLock AI Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev-friendly; tighten for production
    allow_methods=["*"],
    allow_headers=["*"],
)

rule_engine = RuleEngine()
ml_engine = MLEngine()
confidence_scorer = ConfidenceScorer()
adaptive_profile = AdaptiveProfile(db)
gemini_client = GeminiClient()
mqtt_listener = MqttListener(db)


@app.on_event("startup")
def on_startup():
    mqtt_listener.start()
    if not ml_engine.is_ready():
        print("[startup] No trained model found — training on synthetic cold-start data now...")
        try:
            from training.trainer import train
            result = train(db=db)
            ml_engine.reload()
            print(f"[startup] Cold-start training complete: {result}")
        except Exception as e:
            print(f"[startup] Cold-start training failed ({e}). "
                  f"/predict will run rule-engine-only until POST /train succeeds.")


# --------------------------------------------------------------------------- schemas

class ContextStateIn(BaseModel):
    timestamp: int
    idleTime: int
    keyboardActive: bool
    mouseActive: bool
    wifiSSID: str
    rssi: int
    phoneMoving: bool
    battery: int
    charging: bool


class ContextStateOut(ContextStateIn):
    confidence: float
    decision: str
    reason: str


class TrainRequest(BaseModel):
    dataset_path: Optional[str] = None


class TrainResponse(BaseModel):
    accuracy: float
    featuresUsed: List[str]
    trainedAt: int


class CorrectRequest(BaseModel):
    timestamp: int
    correctDecision: str = Field(pattern="^(LOCK|UNLOCK|WAIT)$")


# --------------------------------------------------------------------------- /predict

@app.post("/predict", response_model=ContextStateOut)
def predict(ctx_in: ContextStateIn):
    ctx = ctx_in.model_dump()

    # 1. Rule engine (always runs)
    rule_result = rule_engine.evaluate(ctx)

    # Hard rules (idle+rssi, phoneMoving+rssi, keyboard/mouse active) are decisive
    # on their own — no need to consult ML/Gemini for those.
    is_hard_rule = rule_result.confidence in (95, 85, 90)

    ml_confidence: Optional[float] = None
    blended_confidence = rule_result.confidence
    decision = rule_result.decision
    reason = rule_result.reason
    gemini_used = False

    if not is_hard_rule:
        # 2. ML engine
        ml_confidence = ml_engine.predict_confidence(ctx)
        if ml_confidence is None:
            # No model loaded yet — degrade gracefully to rule-only.
            blended_confidence = rule_result.confidence
            decision = rule_result.decision
            reason = rule_result.reason + " (ML model not yet trained — rule-only)"
        else:
            # 3. Blend
            blended_confidence = confidence_scorer.blend(rule_result.confidence, ml_confidence)
            # 4. Decision gate
            gate = confidence_scorer.gate(blended_confidence)
            decision = gate.decision
            reason = f"Blended confidence {blended_confidence}% (rule {rule_result.confidence}%, ML {ml_confidence}%)"

            # 5. Gemini for the uncertain band
            if gate.needs_gemini:
                gem = gemini_client.decide(ctx, adaptive_profile.summary())
                if gem is not None:
                    decision = gem.decision
                    reason = gem.reason
                    gemini_used = True
                else:
                    reason = (f"Uncertain band ({blended_confidence}%) but Gemini unavailable — "
                              f"defaulting to WAIT")
                    decision = "WAIT"

    # 5b. Persist to SQLite
    row = {
        "timestamp": ctx["timestamp"],
        "idle_time": ctx["idleTime"],
        "rssi": ctx["rssi"],
        "phone_moving": ctx["phoneMoving"],
        "keyboard_active": ctx["keyboardActive"],
        "mouse_active": ctx["mouseActive"],
        "battery": ctx["battery"],
        "charging": ctx["charging"],
        "rule_confidence": rule_result.confidence,
        "ml_confidence": ml_confidence if ml_confidence is not None else rule_result.confidence,
        "blended_confidence": blended_confidence,
        "decision": decision,
        "reason": reason,
        "gemini_used": gemini_used,
    }
    db.insert_prediction(row)

    # 6. Adaptive profile hook (no-op today, reserved for future per-user weighting)
    adaptive_profile.record_decision(row)

    return ContextStateOut(**ctx, confidence=blended_confidence, decision=decision, reason=reason)


# --------------------------------------------------------------------------- /train

@app.post("/train", response_model=TrainResponse)
def train_endpoint(req: TrainRequest):
    try:
        from training.trainer import train
        result = train(dataset_path=req.dataset_path, db=db)
        ml_engine.reload()
        return TrainResponse(
            accuracy=result["accuracy"],
            featuresUsed=result["featuresUsed"],
            trainedAt=result["trainedAt"],
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# --------------------------------------------------------------------------- /correct

@app.post("/correct")
def correct(req: CorrectRequest):
    original = db.find_prediction_near(req.timestamp)
    original_decision = original["decision"] if original else None

    total_corrections = adaptive_profile.record_correction(
        timestamp=req.timestamp,
        original_decision=original_decision,
        correct_decision=req.correctDecision,
    )

    retrained = False
    if adaptive_profile.should_retrain():
        try:
            from training.trainer import train
            train(db=db)
            ml_engine.reload()
            retrained = True
        except Exception as e:
            print(f"[/correct] Auto-retrain skipped: {e}")

    return {
        "saved": True,
        "totalCorrections": total_corrections,
        "retrained": retrained,
    }


# --------------------------------------------------------------------------- /history

@app.get("/history")
def history(n: int = 100):
    rows = db.get_predictions(n=n)
    return [
        {
            "timestamp": r["timestamp"],
            "idleTime": r["idle_time"],
            "rssi": r["rssi"],
            "phoneMoving": bool(r["phone_moving"]),
            "keyboardActive": bool(r["keyboard_active"]),
            "mouseActive": bool(r["mouse_active"]),
            "battery": r["battery"],
            "charging": bool(r["charging"]),
            "ruleConfidence": r["rule_confidence"],
            "mlConfidence": r["ml_confidence"],
            "confidence": r["blended_confidence"],
            "decision": r["decision"],
            "reason": r["reason"],
            "geminiUsed": bool(r["gemini_used"]),
        }
        for r in rows
    ]


# --------------------------------------------------------------------------- /metrics

@app.get("/metrics")
def metrics():
    return compute_metrics(db, ml_engine)


# --------------------------------------------------------------------------- /robot/status
# Fallback for the dashboard when it can't subscribe to MQTT directly from the browser.

@app.get("/robot/status")
def robot_status():
    latest = db.latest_robot_status()
    if latest is None:
        raise HTTPException(status_code=404, detail="No robot status received yet")
    return latest


@app.get("/")
def root():
    return {
        "service": "AirLock AI Engine",
        "status": "running",
        "modelReady": ml_engine.is_ready(),
        "mqttConnected": mqtt_listener.is_connected(),
    }
