/*
  AquaSense ESP8266 firmware - ZJ-S201 flow sensor -> HTTP POST to the local Node.js backend.

  Wiring (NodeMCU):
    Sensor signal (yellow) -> D2 (GPIO4)   *see README: use a voltage divider if the sensor is powered from 5 V*
    Sensor GND (black)     -> GND
    Sensor VCC (red)       -> see README
  The relay and pump are NOT used by this sketch. Never connect the pump to a GPIO.

  Board: "NodeMCU 1.0 (ESP-12E Module)". Edit the CONFIG block only.
*/
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>

// ===================== CONFIG (edit these) =====================
const char*    WIFI_SSID        = "CHANGE_ME";          // your Wi-Fi name (2.4 GHz)
const char*    WIFI_PASSWORD    = "CHANGE_ME";
const char*    BACKEND_HOST     = "CHANGE_ME";          // laptop IPv4 address, e.g. from `ipconfig`
const uint16_t BACKEND_PORT     = 3001;
const char*    DEVICE_ID        = "aquasense-01";
const char*    API_KEY          = "";                   // only if DEVICE_API_KEY is set in backend/.env
const uint8_t  FLOW_PIN         = D2;
const float    PULSES_PER_LITRE = 450.0;                // initial estimate; used only for the Serial Monitor.
                                                        // The dashboard calibration setting is what counts.
const uint32_t SEND_INTERVAL_MS = 2000;
const uint32_t WIFI_RETRY_MS    = 10000;
// ===============================================================

volatile uint32_t pulseCount = 0;
volatile uint32_t lastPulseUs = 0;

void IRAM_ATTR onPulse() {              // interrupt: keep it tiny
  uint32_t now = micros();
  if (now - lastPulseUs > 1000) {       // ignore bounces faster than 1 kHz
    pulseCount++;
    lastPulseUs = now;
  }
}

uint32_t carryPulses = 0, carryMs = 0;  // data not yet delivered (kept across failed sends)
uint32_t lastSend = 0, lastWifiTry = 0;
float totalLitres = 0;

void connectWifi() {
  lastWifiTry = millis();
  Serial.printf("[wifi] connecting to %s ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool postReading(uint32_t pulses, uint32_t intervalMs) {
  float flowLpm = (pulses / PULSES_PER_LITRE) / (intervalMs / 60000.0f);
  char body[220];
  snprintf(body, sizeof(body),
    "{\"deviceId\":\"%s\",\"flowRateLpm\":%.3f,\"pulseCount\":%lu,\"intervalMs\":%lu,\"totalLitres\":%.4f,\"uptimeMs\":%lu,\"rssi\":%d,\"sensorStatus\":\"online\"}",
    DEVICE_ID, flowLpm, (unsigned long)pulses, (unsigned long)intervalMs, totalLitres, (unsigned long)millis(), WiFi.RSSI());

  WiFiClient client;
  HTTPClient http;
  String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/readings";
  http.setTimeout(3000);                // a dead backend must not stall us for long
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) http.addHeader("x-api-key", API_KEY);
  int code = http.POST((uint8_t*)body, strlen(body));
  http.end();
  Serial.printf("[post] pulses=%lu flow=%.2f L/min -> HTTP %d\n", (unsigned long)pulses, flowLpm, code);
  return code >= 200 && code < 300;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nAquaSense ESP8266 starting");
  if (String(BACKEND_HOST) == "CHANGE_ME") Serial.println("[config] Set BACKEND_HOST to your laptop's IP address.");
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), onPulse, FALLING);
  connectWifi();
  lastSend = millis();
}

void loop() {
  uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED && now - lastWifiTry > WIFI_RETRY_MS) {
    Serial.println("[wifi] not connected, retrying");
    connectWifi();
  }
  if (now - lastSend < SEND_INTERVAL_MS) return;

  uint32_t elapsed = now - lastSend;
  lastSend = now;
  noInterrupts(); uint32_t p = pulseCount; pulseCount = 0; interrupts();   // atomic read-and-reset
  carryPulses += p;
  carryMs += elapsed;
  totalLitres += p / PULSES_PER_LITRE;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[wifi] offline, holding %lu pulses\n", (unsigned long)carryPulses);
  } else if (postReading(carryPulses, carryMs)) {
    carryPulses = 0; carryMs = 0;
  } else if (carryMs > 240000) {        // backend down for 4 min: drop old data rather than grow forever
    carryPulses = 0; carryMs = 0;
  }
}
