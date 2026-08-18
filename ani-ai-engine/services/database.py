"""
DatabaseService — thin wrapper around sqlite3 for the AI Engine.

Owns four tables (schemas fixed by the God File / PERSON_2_AI_ENGINE.md):
  - predictions      one row per /predict call
  - corrections      one row per /correct call
  - model_metadata   one row per completed training run
  - robot_status     one row per MQTT airlock/robot/status message
"""

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

DB_PATH = os.environ.get("DATABASE_PATH", "./airlock.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    idle_time INTEGER,
    rssi INTEGER,
    phone_moving INTEGER,
    keyboard_active INTEGER,
    mouse_active INTEGER,
    battery INTEGER,
    charging INTEGER,
    rule_confidence REAL,
    ml_confidence REAL,
    blended_confidence REAL,
    decision TEXT,
    reason TEXT,
    gemini_used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    original_decision TEXT,
    correct_decision TEXT
);

CREATE TABLE IF NOT EXISTS model_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trained_at INTEGER NOT NULL,
    accuracy REAL,
    features TEXT
);

CREATE TABLE IF NOT EXISTS robot_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    state TEXT,
    battery_level INTEGER,
    distance_to_nearest_object REAL,
    intruder_detected INTEGER,
    photo_url TEXT
);
"""


class DatabaseService:
    """Single shared SQLite connection, guarded by a lock (uvicorn is
    single-process by default so this is enough for a college project)."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self):
        with self._lock, self._conn() as conn:
            conn.executescript(_SCHEMA)

    # ---------------------------------------------------------------- predictions
    def insert_prediction(self, row: Dict[str, Any]) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO predictions
                (timestamp, idle_time, rssi, phone_moving, keyboard_active,
                 mouse_active, battery, charging, rule_confidence, ml_confidence,
                 blended_confidence, decision, reason, gemini_used)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    row["timestamp"], row["idle_time"], row["rssi"],
                    int(row["phone_moving"]), int(row["keyboard_active"]),
                    int(row["mouse_active"]), row["battery"], int(row["charging"]),
                    row["rule_confidence"], row["ml_confidence"],
                    row["blended_confidence"], row["decision"], row["reason"],
                    int(row["gemini_used"]),
                ),
            )
            return cur.lastrowid

    def get_predictions(self, n: int = 100) -> List[Dict[str, Any]]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM predictions ORDER BY id DESC LIMIT ?", (n,)
            ).fetchall()
            return [dict(r) for r in rows][::-1]

    def count_predictions(self) -> int:
        with self._lock, self._conn() as conn:
            return conn.execute("SELECT COUNT(*) c FROM predictions").fetchone()["c"]

    def count_gemini_calls_since(self, since_ts: int) -> int:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) c FROM predictions WHERE gemini_used=1 AND timestamp >= ?",
                (since_ts,),
            ).fetchone()
            return row["c"]

    def false_lock_rate(self) -> float:
        """Fraction of LOCK decisions that were later corrected to UNLOCK/WAIT."""
        with self._lock, self._conn() as conn:
            total_locks = conn.execute(
                "SELECT COUNT(*) c FROM predictions WHERE decision='LOCK'"
            ).fetchone()["c"]
            if total_locks == 0:
                return 0.0
            false_locks = conn.execute(
                """SELECT COUNT(*) c FROM corrections
                   WHERE original_decision='LOCK' AND correct_decision!='LOCK'"""
            ).fetchone()["c"]
            return round(false_locks / total_locks, 4)

    # ---------------------------------------------------------------- corrections
    def insert_correction(self, timestamp: int, original_decision: Optional[str],
                           correct_decision: str) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO corrections (timestamp, original_decision, correct_decision) VALUES (?,?,?)",
                (timestamp, original_decision, correct_decision),
            )
            return cur.lastrowid

    def count_corrections(self) -> int:
        with self._lock, self._conn() as conn:
            return conn.execute("SELECT COUNT(*) c FROM corrections").fetchone()["c"]

    def get_corrections(self, n: int = 500) -> List[Dict[str, Any]]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM corrections ORDER BY id DESC LIMIT ?", (n,)
            ).fetchall()
            return [dict(r) for r in rows][::-1]

    def find_prediction_near(self, timestamp: int, tolerance: int = 5) -> Optional[Dict[str, Any]]:
        """Best-effort lookup of the prediction a correction refers to."""
        with self._lock, self._conn() as conn:
            row = conn.execute(
                """SELECT * FROM predictions
                   WHERE timestamp BETWEEN ? AND ?
                   ORDER BY ABS(timestamp - ?) ASC LIMIT 1""",
                (timestamp - tolerance, timestamp + tolerance, timestamp),
            ).fetchone()
            return dict(row) if row else None

    # ------------------------------------------------------------- model_metadata
    def insert_model_metadata(self, trained_at: int, accuracy: float, features: List[str]) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO model_metadata (trained_at, accuracy, features) VALUES (?,?,?)",
                (trained_at, accuracy, json.dumps(features)),
            )
            return cur.lastrowid

    def latest_model_metadata(self) -> Optional[Dict[str, Any]]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM model_metadata ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            d["features"] = json.loads(d["features"]) if d["features"] else []
            return d

    # ---------------------------------------------------------------- robot_status
    def insert_robot_status(self, status: Dict[str, Any]) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO robot_status
                (timestamp, state, battery_level, distance_to_nearest_object,
                 intruder_detected, photo_url) VALUES (?,?,?,?,?,?)""",
                (
                    status["timestamp"], status["state"], status["batteryLevel"],
                    status["distanceToNearestObject"], int(status["intruderDetected"]),
                    status.get("photoUrl"),
                ),
            )
            return cur.lastrowid

    def latest_robot_status(self) -> Optional[Dict[str, Any]]:
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM robot_status ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if not row:
                return None
            return {
                "timestamp": row["timestamp"],
                "state": row["state"],
                "batteryLevel": row["battery_level"],
                "distanceToNearestObject": row["distance_to_nearest_object"],
                "intruderDetected": bool(row["intruder_detected"]),
                "photoUrl": row["photo_url"],
            }


# Module-level singleton used by main.py and services.
db = DatabaseService()
