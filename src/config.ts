import * as path from "path";
import { AgentSettings } from "./shared/types";

// Fixed ports/topics per the God File — do not change silently.
export const REST_PORT = Number(process.env.AIRLOCK_REST_PORT ?? 3000);
export const AI_ENGINE_URL =
  process.env.AIRLOCK_AI_URL ?? "http://localhost:8000";
export const AI_PREDICT_URL = `${AI_ENGINE_URL}/predict`;

export const MQTT_BROKER_URL =
  process.env.AIRLOCK_MQTT_URL ?? "mqtt://localhost:1883";

export const TOPICS = {
  context: "airlock/context",
  robotCommand: "airlock/robot/command",
  robotStatus: "airlock/robot/status",
} as const;

// Sample loop interval (ms). Fixed to 1s per spec.
export const LOOP_INTERVAL_MS = 1000;

// Filesystem layout. Resolved relative to the app root at runtime.
export const APP_ROOT = path.resolve(__dirname, "..");
export const MOCK_PHONE_PATH =
  process.env.AIRLOCK_MOCK_PHONE ??
  path.join(APP_ROOT, "mocks", "mock-phone.json");
export const DB_DIR = path.join(APP_ROOT, "local-db");
export const DB_PATH = path.join(DB_DIR, "airlock.db");
export const LOG_DIR = path.join(APP_ROOT, "logs");

// Defaults seeded into the settings table on first run.
export const DEFAULT_SETTINGS: AgentSettings = {
  sensitivityLevel: 3,
  idleThreshold: 60,
  rssiThreshold: -75,
  useAiEngine: true,
  mqttBrokerUrl: MQTT_BROKER_URL,
};
