#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#define TRIG_PIN 14
#define ECHO_PIN 27
#define LED_PIN  26

// ======================== WI-FI & TELEGRAM CONFIG ========================
const char* WIFI_SSID = "Akaash";
const char* WIFI_PASS = "123456789";

const char* BOT_TOKEN = "8832083833:AAGg-Byz8wuu_bd-KUK8shvUbL2uN5FID20";
const char* CHAT_ID   = "6130283037";

WiFiClientSecure secureClient;
long lastUpdateId = 0;

// States: DORMANT (sleeping until laptop locks), SCANNING (guarding), AWAITING_REPLY, ALARM
enum State { DORMANT, SCANNING, AWAITING_REPLY, ALARM };
State state = DORMANT;

unsigned long awaitStartTime = 0;
unsigned long lastPollTime = 0;
const unsigned long REPLY_TIMEOUT = 30000; // 30s to reply
const unsigned long POLL_INTERVAL = 1500;  // Poll Telegram every 1.5s

// ======================== TELEGRAM FUNCTIONS ========================
void sendTelegramMessage(String text) {
  HTTPClient http;
  String url = "https://api.telegram.org/bot" + String(BOT_TOKEN) + "/sendMessage";
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"chat_id\":\"" + String(CHAT_ID) + "\",\"text\":\"" + text + "\"}";
  int code = http.POST(body);
  Serial.print("[TELEGRAM] Send status: ");
  Serial.println(code);
  http.end();
}

// Reads new Telegram messages and returns lowercased text
String checkTelegramMessage() {
  HTTPClient http;
  String url = "https://api.telegram.org/bot" + String(BOT_TOKEN) +
               "/getUpdates?offset=" + String(lastUpdateId + 1);
  http.begin(secureClient, url);
  int code = http.GET();
  String text = "";

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
          text = msgText;
          Serial.print("[TELEGRAM] Message received: ");
          Serial.println(text);
        }
      }
    }
  }
  http.end();
  return text;
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

// ======================== SENSOR FUNCTION ========================
int getDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}

// ======================== SETUP ========================
void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WIFI] Connecting to ");
  Serial.print(WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected!");

  secureClient.setInsecure();
  clearOldUpdates();

  Serial.println("[AIRLOCK] Bot Ready. State: DORMANT (Waiting for laptop lock signal)");
  sendTelegramMessage("🤖 AirLock Bot Online. State: DORMANT (Waiting for laptop lock).");
}

// ======================== MAIN LOOP ========================
void loop() {
  // 1. DORMANT STATE: Bot is completely quiet while you are at your laptop
  if (state == DORMANT) {
    digitalWrite(LED_PIN, LOW);
    if (millis() - lastPollTime > POLL_INTERVAL) {
      lastPollTime = millis();
      String cmd = checkTelegramMessage();
      if (cmd.indexOf("start") >= 0 || cmd.indexOf("guard") >= 0) {
        state = SCANNING;
        Serial.println("[AIRLOCK] Woken up -> SCANNING / GUARD MODE");
        sendTelegramMessage("🛡️ AirLock: Laptop locked. Guard mode ACTIVE. Scanning for intruders...");
      }
    }
  }

  // 2. SCANNING STATE: Laptop is locked -> Bot actively monitors ultrasonic sensor
  else if (state == SCANNING) {
    digitalWrite(LED_PIN, LOW);
    int distanceCm = getDistanceCm();
    Serial.print("Guard Mode | Distance: ");
    Serial.print(distanceCm);
    Serial.println(" cm");

    // Check for intruder within 50 cm
    if (distanceCm > 0 && distanceCm < 50) {
      Serial.println("[ALERT] Proximity triggered (< 50cm)!");
      sendTelegramMessage("⚠️ AirLock: Someone is near the bot. Reply YES if it's you, NO if not.");
      awaitStartTime = millis();
      lastPollTime = millis();
      state = AWAITING_REPLY;
    }

    // Also check if user unlocked laptop and told bot to stand down
    if (millis() - lastPollTime > POLL_INTERVAL) {
      lastPollTime = millis();
      String cmd = checkTelegramMessage();
      if (cmd.indexOf("stop") >= 0 || cmd.indexOf("stand") >= 0 || cmd.indexOf("unlock") >= 0) {
        state = DORMANT;
        Serial.println("[AIRLOCK] Stood down -> DORMANT");
        sendTelegramMessage("💤 AirLock: Laptop unlocked. Bot is now DORMANT.");
      }
    }
  }

  // 3. AWAITING REPLY STATE: Intruder seen, waiting for YES/NO
  else if (state == AWAITING_REPLY) {
    if (millis() - lastPollTime > POLL_INTERVAL) {
      lastPollTime = millis();
      String reply = checkTelegramMessage();
      if (reply.indexOf("yes") >= 0) {
        Serial.println("[TELEGRAM] Owner verified -> returning to SCANNING");
        sendTelegramMessage("✅ AirLock: Owner verified. Resuming guard scan.");
        state = SCANNING;
      } else if (reply.indexOf("no") >= 0) {
        Serial.println("[TELEGRAM] Intruder confirmed -> ALARM!");
        sendTelegramMessage("🚨 AirLock: INTRUDER ALERT! Alarm triggered!");
        state = ALARM;
      }
    }

    // 30s timeout without reply -> alarm
    if (millis() - awaitStartTime > REPLY_TIMEOUT && state == AWAITING_REPLY) {
      Serial.println("[TIMEOUT] No reply in 30s -> ALARM!");
      sendTelegramMessage("🚨 AirLock: No reply in 30 seconds! Alarm triggered!");
      state = ALARM;
    }
  }

  // 4. ALARM STATE: LED stays on until reset
  else if (state == ALARM) {
    digitalWrite(LED_PIN, HIGH);
    if (millis() - lastPollTime > POLL_INTERVAL) {
      lastPollTime = millis();
      String cmd = checkTelegramMessage();
      if (cmd.indexOf("reset") >= 0 || cmd.indexOf("stop") >= 0 || cmd.indexOf("stand") >= 0) {
        digitalWrite(LED_PIN, LOW);
        state = DORMANT;
        Serial.println("[AIRLOCK] Alarm reset -> DORMANT");
        sendTelegramMessage("✅ AirLock: Alarm reset. Bot is now DORMANT.");
      }
    }
  }

  delay(200);
}
