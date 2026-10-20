# AirLock — Desktop Agent (Person 1)

The laptop-side of AirLock, a proximity-aware auto-lock security system. This
Electron + TypeScript app monitors local activity, merges it with phone sensor
data, decides whether to lock, drives a guard robot over MQTT, and exposes a
local REST API for the AI Engine.

> This workstream is fully independent. It runs and is testable with no other
> engineer's code, using mocks and graceful fallbacks.

## Features

- **Sensor loop (1s):** keyboard + mouse activity, idle time, Wi-Fi SSID, and
  phone data from `mocks/mock-phone.json` merged into a `ContextState`.
- **Lock logic:** calls the AI Engine `POST /predict`; if it's off or
  unreachable, falls back to the local rule `idle > threshold AND rssi < threshold`.
- **Windows lock:** `LockWorkStation` via `rundll32` (macOS/Linux best-effort).
- **REST API (port 3000):** `/context`, `/history`, `/lock`, `/unlock`, `/settings`.
- **MQTT:** publishes `ContextState` to `airlock/context` and `RobotCommand` to
  `airlock/robot/command`; subscribes to `airlock/robot/status`. Never crashes if
  the broker is down — it logs and continues.
- **SQLite (better-sqlite3):** `sensor_log`, `lock_history`, `settings` tables.
- **Electron UI:** Dashboard (live context + decision + robot), Logs (filterable),
  Settings (sensitivity, AI toggle, MQTT address). System tray + notifications.

## Prerequisites

- Node.js 18+ (tested on Node 22)
- Windows build tools for native modules (`better-sqlite3`). On Windows this
  usually works out of the box with recent Node; if native rebuild fails, run
  `npm run rebuild`.

## Install & Run

### 1. Run Complete AirLock System (Bridge + Phone Proximity)
To run the full proximity auto-lock bridge with your phone and ESP32 bot:
```powershell
cd C:\Users\akaas\Downloads\BOT
python ble_airlock_bridge.py
```

### 2. Run Desktop Agent (Electron Dashboard)
```bash
cd C:\Users\akaas\Downloads\BOT\sem7
npm install        # builds native modules against Electron via postinstall
npm start          # compile TypeScript + launch Electron
```

### 3. Run AI Engine (FastAPI)
```powershell
cd C:\Users\akaas\Downloads\BOT\sem7\ani-ai-engine
uvicorn main:app --reload --port 8000
```

## Configuration

Defaults live in `src/config.ts` and are overridable via env vars:

| Var | Default | Purpose |
|---|---|---|
| `AIRLOCK_REST_PORT` | `3000` | REST API port |
| `AIRLOCK_AI_URL` | `http://localhost:8000` | AI Engine base URL |
| `AIRLOCK_MQTT_URL` | `mqtt://localhost:1883` | MQTT broker |
| `AIRLOCK_MOCK_PHONE` | `mocks/mock-phone.json` | Phone data source |

Runtime settings (sensitivity, thresholds, AI toggle, broker) are stored in the
`settings` SQLite table and editable from the Settings screen or `POST /settings`.

## Testing without other workstreams

- **No AI Engine?** Turn off "Use AI Engine" or just leave it — it auto-falls
  back to local rules.
- **No MQTT broker?** Publishes are logged and dropped; the app keeps running.
- **Simulate the phone:** edit `mocks/mock-phone.json` while running (e.g. set
  `"rssi": -85` and wait past the idle threshold to trigger an auto-lock).

Try the API directly:

```bash
curl http://localhost:3000/context
curl -X POST http://localhost:3000/lock
curl -X POST http://localhost:3000/settings -H "Content-Type: application/json" \
  -d "{\"sensitivityLevel\":5}"
```

## Shared contracts

`ContextState`, `RobotCommand`, and `RobotStatus` are defined in
`src/shared/types.ts` and match `AIRLOCK_GOD_FILE.md` exactly. Do not change them
without team agreement.
