#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
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
WebServer server(80);
long lastUpdateId = 0;

// States: DORMANT (sleeping until laptop locks), SCANNING (guarding desk), AWAITING_REPLY, ALARM
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
          text = msgText;
          text.toLowerCase();
          Serial.print("[TELEGRAM] User message: ");
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

// ======================== HARDWARE SENSOR ========================
int getDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return 999;
  return duration * 0.0343 / 2;
}

// ======================== LOCAL HTTP API ========================
void handleStartScanning() {
  state = SCANNING;
  server.send(200, "text/plain", "SCANNING_ACTIVE");
  Serial.println("\n[HTTP COMMAND] Woken up by laptop lock -> SCANNING mode!");
  sendTelegramMessage("🛡️ AirLock Bot ACTIVE: Laptop locked. Guarding desk!");
}

void handleStandDown() {
  state = DORMANT;
  digitalWrite(LED_PIN, LOW);
  server.send(200, "text/plain", "DORMANT_ACTIVE");
  Serial.println("\n[HTTP COMMAND] Stood down by laptop -> DORMANT mode.");
  sendTelegramMessage("💤 AirLock Bot: Laptop safe. Returning to DORMANT mode.");
}

void handleStatus() {
  String s = (state == DORMANT) ? "DORMANT" :
             (state == SCANNING) ? "SCANNING" :
             (state == AWAITING_REPLY) ? "AWAITING_REPLY" : "ALARM";
  server.send(200, "text/plain", s);
}

// ======================== SETUP & LOOP ========================
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

  IPAddress myIP = WiFi.localIP();
  Serial.print("[WIFI] IP Address: ");
  Serial.println(myIP);

  // Setup mDNS name http://airlock-bot.local
  if (MDNS.begin("airlock-bot")) {
    Serial.println("[MDNS] Responder started: http://airlock-bot.local");
  }

  // Setup local HTTP server endpoints
  server.on("/start", HTTP_GET, handleStartScanning);
  server.on("/start_scanning", HTTP_GET, handleStartScanning);
  server.on("/stop", HTTP_GET, handleStandDown);
  server.on("/stand_down", HTTP_GET, handleStandDown);
  server.on("/status", HTTP_GET, handleStatus);
  server.begin();
  Serial.println("[HTTP SERVER] Ready on port 80");

  secureClient.setInsecure();
  clearOldUpdates();

  Serial.println("[AIRLOCK BOT] Initialized in DORMANT state.");
  sendTelegramMessage("🤖 AirLock Bot Online (IP: " + myIP.toString() + "). Sleeping until laptop locks.");
}

void loop() {
  server.handleClient();
  unsigned long now = millis();

  // 1. DORMANT: Waiting for laptop to lock (via HTTP from bridge or Telegram 'start')
  if (state == DORMANT) {
    digitalWrite(LED_PIN, LOW);
    if (now - lastPollTime > POLL_INTERVAL) {
      lastPollTime = now;
      String msg = checkTelegramMessage();
      if (msg.indexOf("start") >= 0 || msg.indexOf("scan") >= 0) {
        state = SCANNING;
        Serial.println("[TELEGRAM] Received start -> SCANNING mode.");
        sendTelegramMessage("🛡️ AirLock Bot ACTIVE: Guarding desk.");
      }
    }
  }

  // 2. SCANNING: Laptop is locked -> Bot actively scans with ultrasonic sensor
  else if (state == SCANNING) {
    digitalWrite(LED_PIN, LOW);
    int distance = getDistanceCm();
    Serial.print("Guarding... Distance: ");
    Serial.print(distance);
    Serial.println(" cm");

    // Check if user replied via Telegram
    if (now - lastPollTime > POLL_INTERVAL) {
      lastPollTime = now;
      String msg = checkTelegramMessage();
      if (msg.indexOf("stand_down") >= 0 || msg.indexOf("stop") >= 0) {
        state = DORMANT;
        Serial.println("[STATE] Telegram stand down -> DORMANT mode.");
        sendTelegramMessage("💤 AirLock Bot: Returning to DORMANT mode.");
        return;
      }
    }

    // Intruder detected within 50 cm
    if (distance > 0 && distance < 50) {
      Serial.println("\n[ALERT] Movement detected at desk! Asking user...");
      sendTelegramMessage("🚨 Desk Alert: Movement detected near your desk! Is this you? Reply YES or NO.");
      awaitStartTime = now;
      lastPollTime = now;
      state = AWAITING_REPLY;
    }
  }

  // 3. AWAITING_REPLY: Waiting for user to confirm on Telegram/Phone App
  else if (state == AWAITING_REPLY) {
    // Flash LED while awaiting verification
    digitalWrite(LED_PIN, (now / 300) % 2 == 0 ? HIGH : LOW);

    if (now - lastPollTime > POLL_INTERVAL) {
      lastPollTime = now;
      String reply = checkTelegramMessage();

      if (reply.indexOf("yes") >= 0 || reply.indexOf("stand") >= 0) {
        Serial.println("[VERIFIED] User replied YES. False alarm.");
        sendTelegramMessage("✅ Verified! Resuming DORMANT mode.");
        state = DORMANT;
      } else if (reply.indexOf("no") >= 0) {
        Serial.println("[INTRUDER] User replied NO! Sounding ALARM!");
        sendTelegramMessage("🚨 INTRUDER CONFIRMED! SOUNDING ALARM!");
        state = ALARM;
      }
    }

    if (now - awaitStartTime > REPLY_TIMEOUT && state == AWAITING_REPLY) {
      Serial.println("[TIMEOUT] No response in 30s! Sounding ALARM!");
      sendTelegramMessage("⚠️ No reply received in 30s. Triggering ALARM!");
      state = ALARM;
    }
  }

  // 4. ALARM: Buzzer/LED stays HIGH until stand_down or reset command
  else if (state == ALARM) {
    digitalWrite(LED_PIN, HIGH);
    if (now - lastPollTime > POLL_INTERVAL) {
      lastPollTime = now;
      String reply = checkTelegramMessage();
      if (reply.indexOf("stand_down") >= 0 || reply.indexOf("stop") >= 0 || reply.indexOf("yes") >= 0 || reply.indexOf("reset") >= 0) {
        Serial.println("[RESET] Alarm cleared.");
        sendTelegramMessage("🛡️ Alarm cleared. Returning to DORMANT mode.");
        state = DORMANT;
      }
    }
  }

  delay(150);
}
