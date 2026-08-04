# AirLock — Person 1: Desktop Systems Engineer

> Feed the God File to Claude Code first, then this file.
> You are fully independent. You need nobody else's code to run or test your work.

---

## What You Own

Everything on the laptop:

- Background service that monitors keyboard, mouse, and idle time
- Windows Lock/Unlock API integration
- Local SQLite database
- Local REST API (Express) that the AI Engine will call
- MQTT publisher for robot commands
- Electron system tray UI with dashboard, logs, and settings
- The `mock-phone.json` file that simulates the phone until Person 2 is done

You do **not** depend on:
- The AI Engine (Person 2) — you call it over REST but it's optional; implement a local
  rule-based fallback (idle > 60s AND rssi < -75 → lock)
- The Robot (Person 3) — you publish to MQTT; if no broker is running, log the command
  and move on
- The Mobile App — you read `mock-phone.json` until integration

---

## Your Mock Files

### `/mocks/mock-phone.json`
You own and ship this. It simulates real-time phone sensor data.

```json
{
  "rssi": -68,
  "phoneMoving": false,
  "battery": 74,
  "charging": false,
  "accelerometer": { "x": 0.1, "y": 0.2, "z": 9.8 }
}
```

Vary the values in this file during testing to simulate different phone states (far away,
moving, low battery, etc). The AI Engine team will use this file too.

---

## Architecture

```
desktop-agent/
├── src/
│   ├── main.ts                  # Electron entry point
│   ├── services/
│   │   ├── ActivityMonitor.ts   # keyboard + mouse + idle
│   │   ├── LockService.ts       # Windows Lock API wrapper
│   │   ├── PhoneDataReader.ts   # reads mock-phone.json (swapped for BLE at integration)
│   │   ├── ContextMerger.ts     # merges desktop + phone → ContextState
│   │   ├── MqttPublisher.ts     # publishes RobotCommand to airlock/robot/command
│   │   └── DatabaseService.ts   # SQLite read/write
│   ├── api/
│   │   └── routes.ts            # Express REST endpoints
│   └── ui/
│       └── tray.ts              # system tray + Electron window
├── mocks/
│   └── mock-phone.json
├── local-db/
│   └── airlock.db               # SQLite, created at runtime
└── package.json
```

---

## Shared Contract You Produce

Your core output is a `ContextState` object, built every second:

```typescript
interface ContextState {
  timestamp: number;
  idleTime: number;
  keyboardActive: boolean;
  mouseActive: boolean;
  wifiSSID: string;
  rssi: number;         // from mock-phone.json
  phoneMoving: boolean; // from mock-phone.json
  battery: number;      // from mock-phone.json
  charging: boolean;    // from mock-phone.json
  confidence?: number;  // filled in by AI Engine — you pass it through, don't write it
  decision?: "LOCK" | "UNLOCK" | "WAIT"; // same
  reason?: string;      // same
}
```

---

## REST API You Expose

Base URL: `http://localhost:3000`

All responses are JSON. All timestamps are Unix epoch seconds.

```
GET  /context         Returns latest ContextState
GET  /history?n=50    Returns last N records from SQLite
POST /lock            Manually lock. Also fires MQTT RobotCommand{action:"GUARD"}
POST /unlock          Manually unlock. Fires MQTT RobotCommand{action:"RETURN_TO_DOCK"}
POST /settings        Body: { sensitivityLevel: 1-5, idleThreshold: number, rssiThreshold: number }
```

### Lock decision flow
```
Every 1 second:
  1. Read desktop sensors (keyboard, mouse, idle)
  2. Read mock-phone.json
  3. Merge → ContextState
  4. POST ContextState to AI Engine /predict (http://localhost:8000/predict)
     → If AI Engine is unreachable, apply local rule:
       if idleTime > 60 AND rssi < -75 → decision = "LOCK"
  5. If decision = "LOCK":
     a. Call Windows Lock API
     b. Publish RobotCommand{action:"GUARD"} to MQTT airlock/robot/command
     c. Log to SQLite
  6. If decision = "UNLOCK":
     a. Publish RobotCommand{action:"RETURN_TO_DOCK"} to MQTT
```

---

## SQLite Schema

```sql
CREATE TABLE sensor_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  idle_time INTEGER,
  keyboard_active INTEGER,
  mouse_active INTEGER,
  wifi_ssid TEXT,
  rssi INTEGER,
  phone_moving INTEGER,
  battery INTEGER,
  charging INTEGER,
  confidence REAL,
  decision TEXT,
  reason TEXT
);

CREATE TABLE lock_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  action TEXT NOT NULL,    -- "LOCK" | "UNLOCK"
  trigger TEXT NOT NULL,   -- "AUTO" | "MANUAL"
  reason TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## MQTT Publishing

Topic: `airlock/robot/command`
Payload: JSON string of `RobotCommand`

```typescript
interface RobotCommand {
  timestamp: number;
  action: "GUARD" | "RETURN_TO_DOCK" | "IDLE";
}
```

Also publish the full `ContextState` to `airlock/context` every second so the dashboard
(Person 2) can subscribe to it for live telemetry.

If the MQTT broker is unavailable, log the failed publish and continue — do not crash.

---

## Electron UI — Screens to Build

### Dashboard
- Live `ContextState` values (idle time, RSSI, phone moving, etc.)
- Current decision badge (LOCK / UNLOCK / WAIT) with confidence bar
- Robot status read from `airlock/robot/status` MQTT topic

### Logs
- Scrollable table of `sensor_log` entries
- Filter by date and decision type

### Settings
- Sensitivity slider (maps to idleThreshold + rssiThreshold)
- Toggle: "Use AI Engine" vs "Local rules only"
- MQTT broker address field

### Notifications
- Windows system tray notification on lock/unlock
- Alert if robot reports `intruderDetected: true`

---

## Technical Stack

| Concern | Library |
|---|---|
| Desktop framework | Electron |
| Language | TypeScript |
| REST API | Express |
| Database | SQLite (`better-sqlite3`) |
| Keyboard/mouse | `node-global-key-listener`, `robotjs` |
| MQTT | `mqtt` (npm) |
| Logging | `winston` |
| Build/package | `electron-builder` |

---

## Claude Code Prompt — Paste After God File

```
I am Person 1 on the AirLock project. I own the Desktop Agent.

Build a production-quality Electron + TypeScript desktop application called
AirLock Desktop Agent with the following requirements:

SENSOR COLLECTION (every 1 second):
- Detect keyboard activity using node-global-key-listener
- Detect mouse activity using robotjs
- Calculate idle time (seconds since last keyboard or mouse event)
- Read current Wi-Fi SSID
- Read mock-phone.json from /mocks/mock-phone.json and merge its fields
  (rssi, phoneMoving, battery, charging) into the ContextState object

LOCK LOGIC:
- Every second, POST the current ContextState to http://localhost:8000/predict
- If the AI Engine is unreachable, fall back to local rule:
    if idleTime > 60 AND rssi < -75 → decision = "LOCK"
- On LOCK decision: call the Windows LockWorkStation() API and publish a
  RobotCommand { action: "GUARD" } to MQTT topic airlock/robot/command
- On UNLOCK decision: publish RobotCommand { action: "RETURN_TO_DOCK" }

REST API (Express, port 3000):
- GET  /context    → return latest ContextState as JSON
- GET  /history    → return last 50 sensor_log rows from SQLite
- POST /lock       → manual lock trigger
- POST /unlock     → manual unlock trigger
- POST /settings   → update { sensitivityLevel, idleThreshold, rssiThreshold }

DATABASE (SQLite via better-sqlite3):
- Tables: sensor_log, lock_history, settings (schemas provided)
- Write every ContextState to sensor_log
- Write every lock/unlock event to lock_history

MQTT (mqtt npm package, broker at localhost:1883):
- Publish ContextState to airlock/context every second
- Publish RobotCommand to airlock/robot/command on lock/unlock
- Subscribe to airlock/robot/status and surface intruder alerts in the UI
- If broker is unreachable, log the error and continue without crashing

ELECTRON UI (4 screens):
- Dashboard: live ContextState, decision badge, confidence bar, robot status
- Logs: table of sensor_log, filterable by date and decision
- Settings: sensitivity slider, AI Engine toggle, MQTT broker address
- Notifications: system tray icon, Windows notifications on lock events

ARCHITECTURE REQUIREMENTS:
- Clean folder structure: services/, api/, ui/, db/
- Each concern in its own TypeScript class with constructor injection
- winston for all logging
- All timestamps as Unix epoch seconds (integers)
- No hardcoded values — read from settings table or environment variables
- Handle MQTT and AI Engine unavailability gracefully (log + fallback, never crash)

The ContextState interface and RobotCommand interface are defined in the God File
I will paste separately. Implement them exactly as specified.
```
