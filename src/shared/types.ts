// Shared contracts. These MUST match AIRLOCK_GOD_FILE.md exactly.
// Do not change field names or types without team agreement.

export type Decision = "LOCK" | "UNLOCK" | "WAIT";
export type RobotAction = "GUARD" | "RETURN_TO_DOCK" | "IDLE";
export type RobotState = "DOCKED" | "MOVING" | "GUARDING" | "CHARGING";

export interface ContextState {
  timestamp: number; // Unix epoch seconds
  idleTime: number; // seconds since last input
  keyboardActive: boolean;
  mouseActive: boolean;
  wifiSSID: string;
  rssi: number; // BLE RSSI in dBm, e.g. -65
  phoneMoving: boolean;
  battery: number; // phone battery %
  charging: boolean;
  // The three fields below are owned by the AI Engine (Person 2).
  // We only pass them through; we never author them.
  confidence?: number; // 0-100
  decision?: Decision;
  reason?: string;
}

export interface RobotCommand {
  timestamp: number;
  action: RobotAction;
}

export interface RobotStatus {
  timestamp: number;
  state: RobotState;
  batteryLevel: number; // 0-100
  distanceToNearestObject: number; // cm
  intruderDetected: boolean;
  photoUrl?: string;
}

// Raw shape of mock-phone.json (owned by Desktop / Person 1).
export interface PhoneData {
  rssi: number;
  phoneMoving: boolean;
  battery: number;
  charging: boolean;
  accelerometer?: { x: number; y: number; z: number };
}

// Persisted settings (also editable via POST /settings).
export interface AgentSettings {
  sensitivityLevel: number; // 1-5
  idleThreshold: number; // seconds
  rssiThreshold: number; // dBm, e.g. -75
  useAiEngine: boolean;
  mqttBrokerUrl: string;
}
