# AirLock — Person 3: Robotics & Embedded Systems Engineer

> Feed the God File to Claude Code first, then this file.
> You are fully independent. You need nobody else's code to run or test your work.

---

## What You Own

Everything physical and everything embedded:

- ESP32 firmware (C++ / Arduino / PlatformIO)
- Motor control and movement (dock → guard position → dock)
- Ultrasonic proximity detection
- BLE scanning (owner whitelist to avoid false alarms)
- LED + buzzer alert system
- ESP32-CAM photo capture on intrusion
- MQTT publishing of RobotStatus
- MQTT subscription to RobotCommand
- A companion Python mock publisher so you can test firmware without the Desktop Agent

You do **not** depend on:
- The Desktop Agent (Person 1) — you read `mock-robot-command.json` during dev and
  have a mock publisher script that fires commands at you
- The AI Engine (Person 2) — the dashboard reads your MQTT output independently
- The Mobile App — you BLE-scan for the owner's phone UUID, but use a hardcoded mock
  UUID during dev; swap it at integration time

---

## Your Mock Files

### `/mocks/mock-robot-command.json`
Simulates commands from the Desktop Agent. Your mock publisher script reads this and
publishes to MQTT so you can trigger guard/dock cycles without running anything else.

```json
{
  "timestamp": 1721049310,
  "action": "GUARD"
}
```

---

## Hardware Bill of Materials

| Component | Purpose | Notes |
|---|---|---|
| ESP32 DevKit (or ESP32-CAM) | Main controller | ESP32-CAM adds photo capture |
| HC-SR04 | Ultrasonic distance sensor | Detects objects within 50cm |
| L298N Motor Driver | Controls two DC motors | Powers left + right drive wheels |
| 2× DC Gear Motors | Movement | With wheels attached |
| LEDs (red × 2, white × 1) | Visual alert + status | |
| Passive buzzer | Audio alert | |
| 18650 LiPo battery pack | Power | With voltage divider for battery% |
| Chassis | Robot body | Any 2-wheel differential drive chassis |
| Jumper wires + breadboard | Wiring | |

### Wiring Summary

```
HC-SR04:
  TRIG → GPIO 5
  ECHO → GPIO 18
  VCC  → 5V
  GND  → GND

L298N:
  IN1  → GPIO 25
  IN2  → GPIO 26
  IN3  → GPIO 27
  IN4  → GPIO 14
  ENA  → GPIO 32 (PWM)
  ENB  → GPIO 33 (PWM)
  12V  → Battery+
  GND  → Battery- and ESP32 GND

LEDs:
  Red alert  → GPIO 13 (via 220Ω resistor)
  Status LED → GPIO 12 (via 220Ω resistor)

Buzzer:
  Signal     → GPIO 4
  GND        → GND

Battery monitor:
  Voltage divider (100kΩ + 47kΩ) → GPIO 34 (ADC)

ESP32-CAM (if using CAM variant):
  PWDN  → GPIO 32
  RESET → -1 (not used)
  XCLK  → GPIO 0
  SIOD  → GPIO 26
  SIOC  → GPIO 27
  (standard AI-THINKER pinout)
```

---

## Architecture

```
robot-firmware/
├── platformio.ini             # PlatformIO project config
├── src/
│   ├── main.cpp               # Entry point, state machine loop
│   ├── MotorControl.h/.cpp    # Left/right motor + movement functions
│   ├── UltrasonicSensor.h/.cpp# HC-SR04 distance reading
│   ├── BleScanner.h/.cpp      # BLE scan for owner UUID whitelist
│   ├── AlertSystem.h/.cpp     # LED + buzzer patterns
│   ├── CameraCapture.h/.cpp   # ESP32-CAM photo + HTTP upload (optional)
│   ├── MqttClient.h/.cpp      # PubSub subscribe/publish
│   └── Config.h               # All constants (WiFi creds, MQTT host, UUIDs, pins)
└── docs/
    └── wiring.md              # Full wiring diagram (text + schematic)

robot-control/                 # Companion tools (no ESP32 needed)
├── mock_publisher.py          # Publishes mock RobotCommand to MQTT for testing
├── status_listener.py         # Subscribes to airlock/robot/status and prints it
└── requirements.txt           # paho-mqtt
```

---

## State Machine

The firmware runs a simple state machine. This is the core loop.

```
States: DOCKED | MOVING_TO_GUARD | GUARDING | MOVING_TO_DOCK | CHARGING

Transitions:

DOCKED
  + receives RobotCommand{action:"GUARD"}
  → set state = MOVING_TO_GUARD
  → run motor sequence to guard position
  → set state = GUARDING

GUARDING
  + receives RobotCommand{action:"RETURN_TO_DOCK"}
  → set state = MOVING_TO_DOCK
  → run motor sequence back to dock
  → set state = DOCKED / CHARGING

GUARDING (no command received)
  every 100ms:
    → read HC-SR04 distance
    → if distance < 50cm:
        → scan BLE for owner UUID (whitelisted MAC or service UUID)
        → if owner NOT found:
            → flash red LEDs
            → sound buzzer (3 beeps)
            → if CAM available: capture photo, HTTP POST to upload endpoint
            → publish RobotStatus{intruderDetected:true, photoUrl:...}

Any state:
  every 1000ms:
    → publish RobotStatus (current state, battery%, distance, intruderDetected)
```

---

## Shared Contracts You Use

### Subscribe: RobotCommand (MQTT topic: `airlock/robot/command`)
```cpp
struct RobotCommand {
  long timestamp;
  String action;  // "GUARD" | "RETURN_TO_DOCK" | "IDLE"
};
```

### Publish: RobotStatus (MQTT topic: `airlock/robot/status`)
```cpp
struct RobotStatus {
  long timestamp;
  String state;             // "DOCKED" | "MOVING" | "GUARDING" | "CHARGING"
  int batteryLevel;         // 0-100, read from ADC
  int distanceToNearestObject; // cm
  bool intruderDetected;
  String photoUrl;          // empty string if no photo
};
```

JSON format for publishing (use ArduinoJson):
```json
{
  "timestamp": 1721049320,
  "state": "GUARDING",
  "batteryLevel": 88,
  "distanceToNearestObject": 120,
  "intruderDetected": false,
  "photoUrl": ""
}
```

---

## MQTT Topics

| Topic | Direction | Payload |
|---|---|---|
| `airlock/robot/command` | Subscribe | RobotCommand JSON |
| `airlock/robot/status` | Publish | RobotStatus JSON |

Broker: `localhost:1883` during dev. In production, same LAN as the laptop.

---

## Owner Whitelist (BLE)

The robot scans for BLE devices during an intrusion alert. If the owner's phone
is visible (by MAC address or advertised UUID), the alert is suppressed — this
avoids false alarms when the owner walks back near the laptop.

During dev, hardcode a mock UUID in `Config.h`:

```cpp
// Config.h
#define OWNER_BLE_UUID  "24:6F:28:AA:BB:CC"  // replace with real phone MAC at integration
```

At integration, Person 2's mobile app will advertise a fixed BLE UUID. Swap the
constant and recompile.

---

## Photo Upload (Optional — ESP32-CAM only)

If using the CAM variant, on intrusion:
1. Capture JPEG frame using the ESP32-CAM library
2. HTTP POST the image as `multipart/form-data` to a configurable endpoint
   (e.g. `http://192.168.x.x:8000/robot/upload-photo`)
3. The AI Engine (Person 2) stores it and returns a URL
4. Include the URL in the next `RobotStatus` publish

If the upload fails, still publish `intruderDetected: true` with an empty `photoUrl`.

---

## Companion Tools (robot-control/)

### mock_publisher.py
Run this on your laptop to fire commands at the robot without needing the Desktop Agent.

```python
# robot-control/mock_publisher.py
import paho.mqtt.client as mqtt
import json, time

client = mqtt.Client()
client.connect("localhost", 1883)

# Fire GUARD command
command = {"timestamp": int(time.time()), "action": "GUARD"}
client.publish("airlock/robot/command", json.dumps(command))
print("Published GUARD")
time.sleep(10)

# Fire RETURN_TO_DOCK
command = {"timestamp": int(time.time()), "action": "RETURN_TO_DOCK"}
client.publish("airlock/robot/command", json.dumps(command))
print("Published RETURN_TO_DOCK")
client.disconnect()
```

### status_listener.py
Run this to watch what the robot is publishing.

```python
# robot-control/status_listener.py
import paho.mqtt.client as mqtt, json

def on_message(client, userdata, msg):
    data = json.loads(msg.payload)
    print(f"[{data['timestamp']}] state={data['state']} dist={data['distanceToNearestObject']}cm "
          f"intruder={data['intruderDetected']}")

client = mqtt.Client()
client.on_message = on_message
client.connect("localhost", 1883)
client.subscribe("airlock/robot/status")
client.loop_forever()
```

---

## Technical Stack

| Concern | Tool |
|---|---|
| IDE / build system | PlatformIO (VS Code extension) |
| Platform | Espressif ESP32 (arduino framework) |
| Language | C++ |
| MQTT | PubSubClient library |
| JSON | ArduinoJson library |
| BLE | ESP32 BLE Arduino library |
| Camera | ESP32 Camera library (CAM variant only) |
| HTTP | HTTPClient (for photo upload) |

### platformio.ini
```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
lib_deps =
  knolleary/PubSubClient@^2.8
  bblanchon/ArduinoJson@^6.21.3
  ESP32 BLE Arduino
monitor_speed = 115200
```

---

## Claude Code Prompt — Paste After God File

```
I am Person 3 on the AirLock project. I own the Robot Firmware.

Build the firmware for a security robot called AirLock Guard Bot using C++
and the Arduino framework in PlatformIO targeting an ESP32 (or ESP32-CAM).

HARDWARE SETUP:
- HC-SR04 ultrasonic sensor: TRIG=GPIO5, ECHO=GPIO18
- L298N motor driver: IN1=25, IN2=26, IN3=27, IN4=14, ENA=32(PWM), ENB=33(PWM)
- Red LED alert: GPIO13, Status LED: GPIO12
- Buzzer: GPIO4
- Battery ADC: GPIO34 (voltage divider, maps 0-4.2V → 0-100%)
- All pin assignments in Config.h as #define constants

STATE MACHINE:
Implement a state machine with states: DOCKED, MOVING_TO_GUARD, GUARDING,
MOVING_TO_DOCK, CHARGING.

- On MQTT message airlock/robot/command with action "GUARD":
  transition to MOVING_TO_GUARD, run pre-programmed motor sequence to guard
  position, then transition to GUARDING.
- On MQTT message with action "RETURN_TO_DOCK":
  transition to MOVING_TO_DOCK, run motor sequence to dock, transition to DOCKED.
- While GUARDING: poll ultrasonic every 100ms.
  If distanceToNearestObject < 50cm:
    Scan BLE for owner UUID (defined as OWNER_BLE_UUID in Config.h).
    If owner NOT detected:
      Flash red LEDs (3× fast blink).
      Sound buzzer (3 beeps, 200ms on, 100ms off).
      If ESP32-CAM available: capture JPEG and HTTP POST to UPLOAD_ENDPOINT.
      Publish RobotStatus with intruderDetected=true.
- Every 1000ms in any state: publish RobotStatus to airlock/robot/status.

MQTT:
- Broker at MQTT_HOST:1883 (defined in Config.h).
- Subscribe: airlock/robot/command
- Publish: airlock/robot/status
- Use PubSubClient. On disconnect, retry every 5 seconds. Never block the main loop.

MQTT PAYLOAD FORMATS (ArduinoJson):
RobotCommand subscribe: { "timestamp": int, "action": "GUARD"|"RETURN_TO_DOCK"|"IDLE" }
RobotStatus publish: { "timestamp": int, "state": string, "batteryLevel": int,
  "distanceToNearestObject": int, "intruderDetected": bool, "photoUrl": string }

BLE SCANNING:
Scan for BLE device with MAC matching OWNER_BLE_UUID for 2 seconds.
Return true if found, false if not. Use ESP32 BLE Arduino library.

MODULES — one .h + .cpp file per concern:
- MotorControl: forward(speed), backward(speed), left(speed), right(speed), stop()
- UltrasonicSensor: getDistanceCm() → int
- BleScanner: isOwnerPresent(uuid) → bool
- AlertSystem: flashAlert(), soundBuzzer(), clearAlert()
- CameraCapture: captureAndUpload(endpoint) → String photoUrl  [stub if no CAM]
- MqttClient: setup(), loop(), publish(topic, payload), onMessage callback
- Config.h: all #define constants (pins, WiFi SSID/pass, MQTT host, BLE UUID, endpoints)

MOTOR SEQUENCES:
Guard position: drive forward 2 seconds at 60% speed, stop.
Return to dock: drive backward 2 seconds at 60% speed, stop.
(Simple pre-programmed routes for now; can be improved with encoders later.)

ALSO BUILD (in robot-control/ as Python scripts):
- mock_publisher.py: connects to localhost:1883, publishes GUARD, waits 10s,
  publishes RETURN_TO_DOCK. Used to test firmware without the Desktop Agent.
- status_listener.py: subscribes to airlock/robot/status, prints each message.
- requirements.txt: paho-mqtt

REQUIREMENTS:
- Never use delay() in the main loop — use millis() for all timing
- Reconnect MQTT and WiFi automatically without blocking
- All magic numbers in Config.h, never hardcoded inline
- Serial.println debug output with [MODULE] prefixes (e.g. [MQTT], [SENSOR])
- platformio.ini with correct lib_deps (PubSubClient, ArduinoJson, ESP32 BLE Arduino)
```
