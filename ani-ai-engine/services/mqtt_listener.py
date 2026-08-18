"""
MqttListener — subscribes to airlock/robot/status (published by Person 3's
robot) and persists each message into the robot_status table so the
dashboard can poll GET /robot/status even without a browser-side MQTT client.

Fixed topic and port per the God File. If the broker is unreachable, this
logs a warning and the rest of the API continues to work normally — the
dashboard falls back to mocks/mock-robot-status.json.
"""

import json
import os
import threading
import time
from typing import Optional

from .database import DatabaseService

BROKER_HOST = os.environ.get("MQTT_BROKER_HOST", "localhost")
BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
ROBOT_STATUS_TOPIC = os.environ.get("MQTT_ROBOT_STATUS_TOPIC", "airlock/robot/status")


class MqttListener:
    def __init__(self, db: DatabaseService):
        self.db = db
        self._client = None
        self._connected = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Starts the MQTT loop in a background thread. Never raises —
        connection failures are logged and swallowed so main.py can boot
        without a broker running (common during dev)."""
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            print("[MqttListener] paho-mqtt not installed — skipping MQTT subscription.")
            return

        def on_connect(client, userdata, flags, rc):
            if rc == 0:
                self._connected = True
                print(f"[MqttListener] Connected to {BROKER_HOST}:{BROKER_PORT}, "
                      f"subscribing to {ROBOT_STATUS_TOPIC}")
                client.subscribe(ROBOT_STATUS_TOPIC)
            else:
                print(f"[MqttListener] Connection failed with code {rc}")

        def on_message(client, userdata, msg):
            try:
                payload = json.loads(msg.payload.decode("utf-8"))
                self.db.insert_robot_status(payload)
            except Exception as e:
                print(f"[MqttListener] Failed to parse/store message: {e}")

        def on_disconnect(client, userdata, rc):
            self._connected = False
            print(f"[MqttListener] Disconnected (rc={rc}). Will retry via loop_forever.")

        self._client = mqtt.Client()
        self._client.on_connect = on_connect
        self._client.on_message = on_message
        self._client.on_disconnect = on_disconnect

        while True:
            try:
                self._client.connect(BROKER_HOST, BROKER_PORT, keepalive=30)
                self._client.loop_forever(retry_first_connection=True)
            except Exception as e:
                print(f"[MqttListener] Broker unreachable at {BROKER_HOST}:{BROKER_PORT} ({e}). "
                      f"Retrying in 10s — dashboard will use /robot/status fallback until then.")
                time.sleep(10)

    def is_connected(self) -> bool:
        return self._connected
