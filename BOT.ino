#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#define TRIG_PIN 14
#define ECHO_PIN 27
#define LED_PIN  26

const char* WIFI_SSID = "Akaash";
const char* WIFI_PASS = "123456789";

// Fill these two in yourself, right here in this file - do not paste them in chat.
// BOT_TOKEN comes from BotFather. CHAT_ID comes from the getUpdates URL step.
const char* BOT_TOKEN = "8832083833:AAGg-Byz8wuu_bd-KUK8shvUbL2uN5FID20";
const char* CHAT_ID   = "6130283037";

WiFiClientSecure secureClient;
long lastUpdateId = 0;

enum State { IDLE, AWAITING_REPLY, ALARM };
State state = IDLE;
unsigned long awaitStartTime = 0;
unsigned long lastPollTime = 0;
const unsigned long REPLY_TIMEOUT = 30000; // 30s to reply
const unsigned long POLL_INTERVAL = 2000;  // check every 2s

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

// returns "yes", "no", or "" if nothing new
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
  // discard any messages sent before boot, so old replies don't trigger anything
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

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WIFI] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected");

  secureClient.setInsecure(); // skip cert validation - fine for a demo
  clearOldUpdates();
}

int getDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}

void loop() {
  int distanceCm = getDistanceCm();
  Serial.print("Distance: ");
  Serial.print(distanceCm);
  Serial.print(" cm | State: ");
  Serial.println(state);

  if (state == IDLE) {
    digitalWrite(LED_PIN, LOW);
    if (distanceCm > 0 && distanceCm < 50) {
      sendTelegramMessage("AirLock: Someone is near the bot. Reply YES if it's you, NO if not.");
      awaitStartTime = millis();
      lastPollTime = millis();
      state = AWAITING_REPLY;
    }
  }
  else if (state == AWAITING_REPLY) {
    if (millis() - lastPollTime > POLL_INTERVAL) {
      lastPollTime = millis();
      String reply = checkForReply();
      if (reply == "yes") {
        Serial.println("Verified - no alarm.");
        state = IDLE;
      } else if (reply == "no") {
        Serial.println("Denied - ALARM.");
        state = ALARM;
      }
    }
    if (millis() - awaitStartTime > REPLY_TIMEOUT && state == AWAITING_REPLY) {
      Serial.println("No reply in time - ALARM.");
      state = ALARM;
    }
  }
  else if (state == ALARM) {
    digitalWrite(LED_PIN, HIGH);
    // stays lit until you manually reset the board
  }

  delay(300);
}
