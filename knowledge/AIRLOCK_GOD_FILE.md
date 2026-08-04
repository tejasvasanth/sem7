# AirLock — God File (Feed This to Claude Code First, Every Session)

> This file is shared across all three engineers. Feed it to Claude Code at the start
> of every session before any other prompt. It gives the model full system context so
> it never makes assumptions that break another person's code.

---

## What We Are Building

**AirLock** is a proximity-aware auto-lock security system. Your phone acts as a physical
key. When the phone moves away from the laptop and you go idle, the laptop locks
automatically. A physical security robot then drives over, stands guard, and sends an
alert if anyone approaches. When you return, everything resets.

Three people are building this in parallel. No one waits on anyone else. Every workstream
develops against mock data and swaps in real data at integration time.

---

## The Three Workstreams

| # | Owner | Domain | Stack |
|---|---|---|---|
| 1 | Desktop Engineer | Laptop agent + local REST API + SQLite | TypeScript, Electron, Express, SQLite |
| 2 | AI & Analytics Engineer | Decision engine + ML + React dashboard | Python, FastAPI, scikit-learn, React |
| 3 | Robotics Engineer | ESP32 robot firmware + guard logic | C++, Arduino/PlatformIO, MQTT, BLE |

---

## Shared Contracts — DO NOT CHANGE WITHOUT TEAM AGREEMENT

These are the only schemas that cross workstream boundaries. All mock files must
conform to these exactly.

### ContextState
Produced by the Desktop Agent (Person 1). Consumed by the AI Engine (Person 2).
Person 3 reads it from MQTT for dashboard telemetry only.

```typescript
interface ContextState {
  timestamp: number;          // Unix epoch seconds
  idleTime: number;           // seconds since last input
  keyboardActive: boolean;
  mouseActive: boolean;
  wifiSSID: string;
  rssi: number;               // BLE RSSI in dBm (e.g. -65). Simulated by Desktop from mock-phone.json
  phoneMoving: boolean;       // from phone accelerometer, simulated in mock
  battery: number;            // phone battery %, simulated in mock
  charging: boolean;          // phone charging state, simulated in mock
  confidence?: number;        // 0–100, filled in by AI Engine after prediction
  decision?: "LOCK" | "UNLOCK" | "WAIT";  // filled in by AI Engine
  reason?: string;            // human-readable explanation, filled in by AI Engine
}
```

### RobotCommand
Produced by the Desktop Agent (Person 1) after a lock event. Consumed by the Robot (Person 3).

```typescript
interface RobotCommand {
  timestamp: number;
  action: "GUARD" | "RETURN_TO_DOCK" | "IDLE";
}
```

### RobotStatus
Produced by the Robot (Person 3). Consumed by the AI dashboard (Person 2) for display.

```typescript
interface RobotStatus {
  timestamp: number;
  state: "DOCKED" | "MOVING" | "GUARDING" | "CHARGING";
  batteryLevel: number;           // 0–100
  distanceToNearestObject: number; // cm, from ultrasonic sensor
  intruderDetected: boolean;
  photoUrl?: string;              // only present when ESP32-CAM fires
}
```

---

## Communication Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MQTT Broker                              │
│                   (Mosquitto, localhost:1883)                   │
│                                                                 │
│  airlock/context      ← Desktop Agent publishes ContextState    │
│  airlock/decision     ← AI Engine publishes ContextState+decision│
│  airlock/robot/command← Desktop Agent publishes RobotCommand    │
│  airlock/robot/status ← Robot publishes RobotStatus            │
└─────────────────────────────────────────────────────────────────┘

Desktop Agent  ──REST──►  AI Engine  (POST /predict)
Desktop Agent  ──MQTT──►  Robot      (airlock/robot/command)
Robot          ──MQTT──►  Dashboard  (airlock/robot/status)
```

### REST API — Desktop Agent (Person 1)
Base URL: `http://localhost:3000`

| Method | Path | Description |
|---|---|---|
| GET | `/context` | Latest merged ContextState |
| GET | `/history` | Last N sensor records from SQLite |
| POST | `/lock` | Lock workstation + emit GUARD command |
| POST | `/unlock` | Unlock workstation + emit RETURN_TO_DOCK |
| POST | `/settings` | Update sensitivity / preferences |

### REST API — AI Engine (Person 2)
Base URL: `http://localhost:8000`

| Method | Path | Description |
|---|---|---|
| POST | `/predict` | Accepts ContextState, returns decision + confidence + reason |
| POST | `/train` | Trigger model retraining |
| GET | `/history` | Decision history from SQLite |
| GET | `/metrics` | Model accuracy, false lock rate, etc. |

---

## Mock Files — The Glue During Development

Every engineer ships these mock files with their repo so the others can simulate
their data without running any external code.

### mock-phone.json (owned by Desktop, simulates Mobile)
```json
{
  "rssi": -68,
  "phoneMoving": false,
  "battery": 74,
  "charging": false,
  "accelerometer": { "x": 0.1, "y": 0.2, "z": 9.8 }
}
```

### mock-context.json (owned by AI Engine, simulates Desktop output)
```json
{
  "timestamp": 1721049301,
  "idleTime": 42,
  "keyboardActive": false,
  "mouseActive": false,
  "wifiSSID": "Home",
  "rssi": -72,
  "phoneMoving": true,
  "battery": 68,
  "charging": false
}
```

### mock-robot-command.json (owned by Robot, simulates Desktop trigger)
```json
{
  "timestamp": 1721049310,
  "action": "GUARD"
}
```

---

## Development Rules (Everyone Must Follow)

1. **Never block on another workstream.** If you need data from someone else, read
   a mock file. Mocks live in `/mocks/` in each repo root.

2. **Never change a shared contract schema** without putting it to a team message
   first. Changing field names or types silently will break everyone.

3. **MQTT topics are fixed.** Do not invent new ones without updating this file.
   All topics are prefixed `airlock/`.

4. **Ports are fixed.** Desktop REST = `3000`. AI REST = `8000`. MQTT = `1883`.
   Do not change these; everyone's mock configs assume them.

5. **Timestamps are always Unix epoch seconds** (integer). No ISO strings, no
   milliseconds.

6. **All RSSI values are negative integers in dBm.** `-50` is close/strong.
   `-90` is far/weak. Treat anything below `-80` as "phone is likely away."

7. **The `decision` and `confidence` fields on ContextState are filled in by the
   AI Engine only.** The Desktop Agent must not write to them.

---

## Integration Checklist (Run at the End)

- [ ] Desktop Agent reads real phone data over BLE/WebSocket instead of `mock-phone.json`
- [ ] AI Engine receives real ContextState from Desktop Agent's `/context` endpoint
- [ ] Desktop Agent calls AI Engine's `/predict` before deciding to lock
- [ ] Desktop Agent publishes `RobotCommand` to real MQTT broker on lock/unlock
- [ ] Robot subscribes to real MQTT broker instead of reading `mock-robot-command.json`
- [ ] Dashboard subscribes to `airlock/robot/status` for live robot telemetry
- [ ] Robot's BLE whitelist UUID matches the real phone's BLE identity from Person 2's app

---

## Folder Structure Convention

```
airlock/
├── AIRLOCK_GOD_FILE.md        ← this file, at repo root
├── desktop-agent/             ← Person 1
├── ai-engine/                 ← Person 2
├── dashboard/                 ← Person 2
├── robot-firmware/            ← Person 3
├── mocks/
│   ├── mock-phone.json
│   ├── mock-context.json
│   └── mock-robot-command.json
└── docs/
    └── wiring.md              ← Person 3 hardware diagram
```

---

## How to Start a Claude Code Session

Paste this at the top of every Claude Code session, before your personal prompt:

```
I am working on AirLock, a proximity-aware auto-lock security system. 
Here is the full system context file all engineers share:

[PASTE CONTENTS OF THIS FILE]

I am Person [1 / 2 / 3]. My specific workstream brief follows.
```

Then paste your individual workstream file (`PERSON_1.md`, `PERSON_2.md`, or `PERSON_3.md`).
