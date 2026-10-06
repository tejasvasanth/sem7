#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>

// ======================== HARDWARE PINOUT ========================
#define TRIG_PIN 14
#define ECHO_PIN 27
#define LED_PIN  26

// ======================== CONFIGURATION ========================
// Wi-Fi Credentials
const char* WIFI_SSID = "Akaash";
const char* WIFI_PASS = "123456789";

// Telegram Configuration
const char* BOT_TOKEN = "8832083833:AAGg-Byz8wuu_bd-KUK8shvUbL2uN5FID20";
const char* CHAT_ID   = "6130283037";

// MQTT Broker Configuration (Your laptop's current Wi-Fi IP address)
const char* MQTT_BROKER = "192.168.0.105";
const int   MQTT_PORT   = 1883;

// AirLock Contract Topics (from AIRLOCK_GOD_FILE.md)
const char* TOPIC_COMMAND = "airlock/robot/command";
const char* TOPIC_STATUS  = "airlock/robot/status";

// ======================== NETWORK CLIENTS ========================
WiFiClient espClient;
PubSubClient mqttClient(espClient);
WiFiClientSecure secureClient;

long lastUpdateId = 0;

enum RobotState {
  STATE_DOCKED,
  STATE_GUARDING,
  STATE_AWAITING_REPLY,
  STATE_ALARM
};

RobotState state = STATE_DOCKED;
unsigned long awaitStartTime = 0;
unsigned long lastTelegramPollTime = 0;
unsigned long lastStatusPublishTime = 0;
unsigned long lastMqttReconnectAttempt = 0;

const unsigned long REPLY_TIMEOUT           = 30000; // 30s to reply via Telegram
const unsigned long POLL_INTERVAL           = 2000;  // Poll Telegram every 2s
const unsigned long STATUS_PUBLISH_INTERVAL = 1000;  // Telemetry publish every 1s

bool intruderDetected = false;
int currentDistanceCm = 0;

// ======================== TELEGRAM FUNCTIONS ========================
void sendTelegramMessage(String text) {
  HTTPClient http;
  String url = "https://api.telegram.org/bot" + String(BOT_TOKEN) + "/sendMessage";
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"chat_id\":\"" + String(CHAT_ID) + "\",\"text\":\"" + text + "\"}";
  int code = http.POST(body);
  Serial.print("[TELEGRAM] send status: ");
  Serial.println(code);
  if (code != 200) {
    Serial.println("[TELEGRAM] response: " + http.getString());
  }
  http.end();
}

// Returns "yes", "no", or "" if no reply from owner
String checkForReply() {
  HTTPClient http;
  String url = "https://api.telegram.org/bot" + String(BOT_TOKEN) +
               "/getUpdates?offset=" + String(lastUpdateId + 1);
  http.begin(secureClient, url);
  int code = http.GET();
  String reply = "";

  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(4096);
    deserializeJson(doc, payload);
    JsonArray results = doc["result"].as<JsonArray>();

    for (JsonObject update : results) {
      lastUpdateId = update["update_id"].as<long>();
      if (update["message"]["text"].is<const char*>()) {
        String msgText = update["message"]["text"].as<String>();
        String fromChatId = update["message"]["chat"]["id"].as<String>();
        if (fromChatId == String(CHAT_ID)) {
          msgText.toLowerCase();
          if (msgText.indexOf("yes") >= 0) reply = "yes";
          else if (msgText.indexOf("no") >= 0) reply = "no";
        }
      }
    }
  }
  http.end();
  return reply;
}

void clearOldUpdates() {
  HTTPClient http;
  String url = "https://api.telegram.org/bot" + String(BOT_TOKEN) + "/getUpdates";
  http.begin(secureClient, url);
  if (http.GET() == 200) {
    DynamicJsonDocument doc(4096);
    deserializeJson(doc, http.getString());
    JsonArray results = doc["result"].as<JsonArray>();
    for (JsonObject update : results) {
      lastUpdateId = update["update_id"].as<long>();
    }
  }
  http.end();
}

// ======================== SENSOR FUNCTIONS ========================
int getDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}

// ======================== MQTT FUNCTIONS ========================
void publishRobotStatus() {
  StaticJsonDocument<256> doc;
  doc["timestamp"] = (long)(millis() / 1000);

  if (state == STATE_DOCKED) {
    doc["state"] = "DOCKED";
  } else if (state == STATE_GUARDING) {
    doc["state"] = "GUARDING";
  } else if (state == STATE_AWAITING_REPLY || state == STATE_ALARM) {
    doc["state"] = "GUARDING";
  } else {
    doc["state"] = "MOVING";
  }

  doc["batteryLevel"] = 100;
  doc["distanceToNearestObject"] = currentDistanceCm;
  doc["intruderDetected"] = intruderDetected;
  doc["photoUrl"] = "";

  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish(TOPIC_STATUS, buffer);
  Serial.print("[MQTT] Published status: ");
  Serial.println(buffer);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.print("[MQTT] JSON parse failed: ");
    Serial.println(error.f_str());
    return;
  }

  const char* action = doc["action"];
  if (action) {
    Serial.print("[MQTT] Received RobotCommand action: ");
    Serial.println(action);

    if (strcmp(action, "GUARD") == 0) {
      state = STATE_GUARDING;
      intruderDetected = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("[AIRLOCK] Mode changed -> GUARDING");
    } else if (strcmp(action, "RETURN_TO_DOCK") == 0 || strcmp(action, "IDLE") == 0) {
      state = STATE_DOCKED;
      intruderDetected = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("[AIRLOCK] Mode changed -> DOCKED/IDLE");
    }
  }
}

void checkMqttConnection() {
  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > 5000) {
      lastMqttReconnectAttempt = now;
      Serial.print("[MQTT] Connecting to broker at ");
      Serial.print(MQTT_BROKER);
      Serial.print("...");

      String clientId = "ESP32-AirLockRobot-" + String(random(0xffff), HEX);
      if (mqttClient.connect(clientId.c_str())) {
        Serial.println(" connected!");
        mqttClient.subscribe(TOPIC_COMMAND);
        Serial.print("[MQTT] Subscribed to ");
        Serial.println(TOPIC_COMMAND);
      } else {
        Serial.print(" failed, state=");
        Serial.println(mqttClient.state());
      }
    }
  } else {
    mqttClient.loop();
  }
}

// ======================== SETUP & MAIN LOOP ========================
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WIFI] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected");

  secureClient.setInsecure(); // Telegram SSL bypass
  clearOldUpdates();

  // Setup MQTT
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  Serial.println("[AIRLOCK] ESP32 Ready. Default state: DOCKED");
}

void loop() {
  checkMqttConnection();

  currentDistanceCm = getDistanceCm();

  // Periodic MQTT status publish (every 1 second)
  if (millis() - lastStatusPublishTime > STATUS_PUBLISH_INTERVAL) {
    lastStatusPublishTime = millis();
    if (mqttClient.connected()) {
      publishRobotStatus();
    }
  }

  // State Machine logic
  if (state == STATE_GUARDING) {
    digitalWrite(LED_PIN, LOW);
    if (currentDistanceCm > 0 && currentDistanceCm < 50) {
      intruderDetected = true;
      Serial.println("[ALERT] Proximity triggered (< 50cm)! Sending Telegram message...");
      sendTelegramMessage("AirLock: Someone is near the bot. Reply YES if it's you, NO if not.");
      awaitStartTime = millis();
      lastTelegramPollTime = millis();
      state = STATE_AWAITING_REPLY;
    }
  }
  else if (state == STATE_AWAITING_REPLY) {
    if (millis() - lastTelegramPollTime > POLL_INTERVAL) {
      lastTelegramPollTime = millis();
      String reply = checkForReply();
      if (reply == "yes") {
        Serial.println("[TELEGRAM] Owner verified — no alarm.");
        intruderDetected = false;
        state = STATE_GUARDING;
      } else if (reply == "no") {
        Serial.println("[TELEGRAM] Intruder denied — ALARM!");
        state = STATE_ALARM;
      }
    }
    if (millis() - awaitStartTime > REPLY_TIMEOUT && state == STATE_AWAITING_REPLY) {
      Serial.println("[TIMEOUT] No reply within 30s — ALARM!");
      state = STATE_ALARM;
    }
  }
  else if (state == STATE_ALARM) {
    intruderDetected = true;
    digitalWrite(LED_PIN, HIGH);
  }
  else if (state == STATE_DOCKED) {
    digitalWrite(LED_PIN, LOW);
    intruderDetected = false;
  }

  delay(100);
}
