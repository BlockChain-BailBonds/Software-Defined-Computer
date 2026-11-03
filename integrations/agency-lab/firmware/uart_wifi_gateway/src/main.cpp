// Standalone, opt-in UART laboratory bridge. Does NOT preserve existing CYD display firmware.
// No pin, Wi-Fi, or credential defaults: all provisioned locally over USB serial.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <HardwareSerial.h>
#include <mbedtls/base64.h>

Preferences prefs;
HardwareSerial externalUart(1);
String serialBuffer;
String ssid, wifiPass, serverHost, deviceId, deviceToken;
uint16_t serverPort = 8789;
int rxPin = -1, txPin = -1;
uint32_t uartBaud = 115200;
bool localTxEnabled = false, uartStarted = false, autoStart = false;
uint32_t lastHeartbeat = 0, lastPoll = 0, lastWiFiTry = 0;

void loadConfiguration() {
  prefs.begin("agency-lab", false);
  ssid = prefs.getString("ssid", "");
  wifiPass = prefs.getString("wifi", "");
  serverHost = prefs.getString("host", "");
  deviceId = prefs.getString("id", "");
  deviceToken = prefs.getString("token", "");
  serverPort = prefs.getUShort("port", 8789);
  rxPin = prefs.getInt("rx", -1);
  txPin = prefs.getInt("tx", -1);
  uartBaud = prefs.getUInt("baud", 115200);
  localTxEnabled = prefs.getBool("allowtx", false);
  autoStart = prefs.getBool("autostart", false);
}

bool validPin(int pin) {
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  // Avoid input-only, boot strapping, USB, UART0, and most external flash/PSRAM pins.
  return (pin >= 1 && pin <= 18) || pin == 21 || (pin >= 38 && pin <= 42);
#elif defined(CONFIG_IDF_TARGET_ESP32)
  // Explicit operator choice still must be checked against the actual LCD/touch pin map.
  return (pin >= 13 && pin <= 19) || (pin >= 21 && pin <= 23) ||
         (pin >= 25 && pin <= 27) || pin == 32 || pin == 33;
#else
  return false;
#endif
}

bool validLocalHost() {
  IPAddress ip;
  if (!ip.fromString(serverHost)) return false;
  return ip[0] == 10 || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) ||
         (ip[0] == 192 && ip[1] == 168);
}

bool beginUart() {
  if (!validPin(rxPin)) {
    Serial.println("UART DISABLED: set a verified RX GPIO via SET UART_RX N");
    return false;
  }
  if (localTxEnabled && (!validPin(txPin) || txPin == rxPin)) {
    Serial.println("UART DISABLED: TX needs a separate verified GPIO");
    return false;
  }
  if (!(uartBaud == 9600 || uartBaud == 19200 || uartBaud == 38400 ||
        uartBaud == 57600 || uartBaud == 115200 || uartBaud == 230400)) {
    Serial.println("UART DISABLED: unsupported baud rate");
    return false;
  }
  if (uartStarted) externalUart.end();
  externalUart.begin(uartBaud, SERIAL_8N1, rxPin, localTxEnabled ? txPin : -1);
  uartStarted = true;
  Serial.println("UART started. RX capture enabled; TX permission requires both local and forum policies.");
  return true;
}

void printConfiguration() {
  Serial.printf("SSID: %s\nHOST: %s:%u\nDEVICE_ID: %s\nRX: %d, TX: %d\nBAUD: %u\nTX_ENABLED: %s\n",
    ssid.c_str(), serverHost.c_str(), serverPort, deviceId.c_str(), rxPin, txPin,
    (unsigned)uartBaud, localTxEnabled ? "yes" : "no");
  Serial.printf("AUTO_START: %s\n", autoStart ? "YES" : "NO");
  Serial.println("Secrets: stored in NVS, never displayed. Use REKEY to remove device token.");
}

void handleCommand(const String &cmd) {
  if (cmd == "SHOW") { printConfiguration(); return; }
  if (cmd == "HELP") {
    Serial.println("SET WIFI_SSID text | SET WIFI_PASS text | SET HOST private_ipv4 | SET PORT number");
    Serial.println("SET DEVICE_ID node-... | SET DEVICE_TOKEN token | SET UART_RX gpio | SET UART_TX gpio");
    Serial.println("SET BAUD 115200 | SET TX_ENABLE YES/NO | SET AUTO_START YES/NO | START | STOP | SHOW | REKEY");
    return;
  }
  if (cmd == "STOP") { if (uartStarted) externalUart.end(); uartStarted = false; Serial.println("UART stopped"); return; }
  if (cmd == "REKEY") { prefs.remove("token"); deviceToken = ""; Serial.println("Device token cleared"); return; }
  if (cmd == "START") {
    if (!ssid.length() || !validLocalHost() || !deviceId.startsWith("node-") || !deviceToken.length()) {
      Serial.println("CONFIG INCOMPLETE: private IPv4 host, SSID, enrolled ID and token required"); return;
    }
    beginUart(); return;
  }
  if (!cmd.startsWith("SET ")) { Serial.println("Unknown command; type HELP"); return; }
  int split = cmd.indexOf(' ', 4);
  if (split < 0) { Serial.println("SET requires key and value"); return; }
  String key = cmd.substring(4, split), val = cmd.substring(split + 1);
  val.trim();
  if (val.length() == 0 || val.length() > 180) { Serial.println("Invalid value length"); return; }
  if (key == "WIFI_SSID") { ssid = val; prefs.putString("ssid", val); }
  else if (key == "WIFI_PASS") { wifiPass = val; prefs.putString("wifi", val); }
  else if (key == "HOST") {
    serverHost = val;
    if (!validLocalHost()) { serverHost = prefs.getString("host", ""); Serial.println("HOST must be private IPv4"); return; }
    prefs.putString("host", val);
  } else if (key == "PORT") {
    int valNum = val.toInt(); if (valNum < 1024 || valNum > 65535) { Serial.println("Invalid port"); return; }
    serverPort = (uint16_t)valNum; prefs.putUShort("port", serverPort);
  } else if (key == "DEVICE_ID") {
    if (!val.startsWith("node-") || val.length() > 64) { Serial.println("Invalid device ID"); return; }
    deviceId = val; prefs.putString("id", val);
  } else if (key == "DEVICE_TOKEN") { deviceToken = val; prefs.putString("token", val); }
  else if (key == "UART_RX" || key == "UART_TX") {
    int pin = val.toInt(); if (!validPin(pin)) { Serial.println("GPIO disallowed; verify board pin map"); return; }
    if (key == "UART_RX") { rxPin = pin; prefs.putInt("rx", pin); }
    else { txPin = pin; prefs.putInt("tx", pin); }
    if (uartStarted) { externalUart.end(); uartStarted = false; }
  } else if (key == "BAUD") {
    unsigned long num = val.toInt();
    if (num != 9600 && num != 19200 && num != 38400 && num != 57600 && num != 115200 && num != 230400) {
      Serial.println("Unsupported baud"); return;
    }
    uartBaud = num; prefs.putUInt("baud", num);
    if (uartStarted) { externalUart.end(); uartStarted = false; }
  } else if (key == "AUTO_START") {
    if (val != "YES" && val != "NO") { Serial.println("Use YES or NO"); return; }
    autoStart = val == "YES"; prefs.putBool("autostart", autoStart);
  } else if (key == "TX_ENABLE") {
    if (val != "YES" && val != "NO") { Serial.println("Use YES or NO"); return; }
    localTxEnabled = val == "YES"; prefs.putBool("allowtx", localTxEnabled);
    if (uartStarted) { externalUart.end(); uartStarted = false; }
  } else { Serial.println("Unknown SET key"); return; }
  Serial.println("Saved. Run START to initialize the UART after verifying the physical wiring.");
}

void usbCommands() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length()) { handleCommand(serialBuffer); serialBuffer = ""; }
    } else if (c >= 32 && c <= 126) {
      if (serialBuffer.length() < 220) serialBuffer += c;
      else { serialBuffer = ""; Serial.println("Command too long; dropped"); }
    }
  }
}

String serverUrl(const String &path) {
  return "http://" + serverHost + ":" + String(serverPort) + path;
}

int makeRequest(const String &path, bool post, const String &payload, String &response) {
  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, serverUrl(path))) return -1;
  http.setTimeout(3000);
  http.addHeader("x-device-token", deviceToken);
  if (post) http.addHeader("Content-Type", "application/json");
  int code = post ? http.POST(payload) : http.GET();
  if (code > 0) response = http.getString();
  http.end();
  return code;
}

void heartbeat() {
  DynamicJsonDocument doc(512);
  JsonObject capabilities = doc.createNestedObject("capabilities");
  capabilities["transport"] = "esp32-wifi-uart";
  capabilities["uart_initialized"] = uartStarted;
  capabilities["uart_rx"] = rxPin;
  capabilities["uart_tx"] = localTxEnabled ? txPin : -1;
  capabilities["baud"] = uartBaud;
  capabilities["tx_local_permission"] = localTxEnabled;
  capabilities["firmware"] = "agency-uart-bridge-0.1";
  String data, ignored; serializeJson(doc, data);
  int status = makeRequest("/api/device/" + deviceId + "/heartbeat", true, data, ignored);
  if (status != 200) Serial.printf("Heartbeat not accepted: HTTP %d\n", status);
}

bool parseHex(const char *hex, uint8_t *out, size_t &bytes) {
  size_t n = strlen(hex);
  if (n < 2 || n > 512 || n % 2 != 0) return false;
  bytes = n / 2;
  for (size_t i = 0; i < bytes; i++) {
    char a = hex[i*2], b = hex[i*2+1];
    int u = isdigit(a) ? a - '0' : (a >= 'A' && a <= 'F' ? a - 'A' + 10 : -1);
    int l = isdigit(b) ? b - '0' : (b >= 'A' && b <= 'F' ? b - 'A' + 10 : -1);
    if (u < 0 || l < 0) return false;
    out[i] = (u << 4) | l;
  }
  return true;
}

void pollJobs() {
  String response;
  int status = makeRequest("/api/device/" + deviceId + "/next", false, "", response);
  if (status != 200) { Serial.printf("Poll HTTP %d\n", status); return; }
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, response) || doc["job"].isNull()) return;
  String jobId = doc["job"]["id"].as<String>();
  String op = doc["job"]["operation"].as<String>();
  int duration = constrain((int)(doc["job"]["request"]["duration_ms"] | 500), 100, 2500);
  int maxBytes = constrain((int)(doc["job"]["request"]["max_bytes"] | 256), 1, 1024);
  uint8_t rx[1024]; size_t count = 0;
  bool ok = true; String error = "", bridge = "esp32-wifi-uart";
  uint32_t started = millis();
  if (!uartStarted) { ok = false; error = "UART not initialized; set verified pins and run START"; }
  else if (op == "ping") bridge = "Bridge UART initialized; peer presence not proven";
  else if (op == "uart_capture" || op == "uart_tx") {
    if (op == "uart_tx") {
      if (!localTxEnabled) { ok = false; error = "Local TX permission disabled"; }
      else {
        uint8_t tx[256]; size_t txLen = 0;
        String frame = doc["job"]["request"]["tx_hex"].as<String>();
        if (!parseHex(frame.c_str(), tx, txLen)) { ok = false; error = "Invalid TX frame"; }
        else if (externalUart.write(tx, txLen) != txLen) { ok = false; error = "Partial UART write"; }
        else externalUart.flush();
      }
    }
    if (ok) {
      while ((uint32_t)(millis() - started) < (uint32_t)duration && count < (size_t)maxBytes) {
        while (externalUart.available() && count < (size_t)maxBytes) rx[count++] = externalUart.read();
        delay(2);
      }
    }
  } else { ok = false; error = "Unknown operation"; }
  unsigned char encoded[1450]; size_t encodedLen = 0;
  int b64status = mbedtls_base64_encode(encoded, sizeof(encoded)-1, &encodedLen, rx, count);
  if (b64status != 0) { ok = false; error = "Base64 encoding failed"; count = 0; encodedLen = 0; }
  encoded[encodedLen] = '\0';
  DynamicJsonDocument result(2400);
  result["ok"] = ok;
  result["rx_b64"] = (char *)encoded;
  result["bytes_received"] = count;
  result["elapsed_ms"] = min((uint32_t)10000, (uint32_t)(millis() - started));
  result["error"] = error;
  result["bridge"] = bridge;
  String payload, reply; serializeJson(result, payload);
  int postStatus = makeRequest("/api/device/" + deviceId + "/result/" + jobId, true, payload, reply);
  Serial.printf("Job %s: %s; bytes=%u; API=%d\n", jobId.c_str(), ok ? "PASS" : "FAIL", (unsigned)count, postStatus);
}

void setup() {
  Serial.begin(115200);
  delay(700);
  loadConfiguration();
  Serial.println("Evil Agency Lab UART bridge (standalone). HELP for configuration.");
  printConfiguration();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  // After explicit USB provisioning, operator may opt in to subsequent boot activation.
  // Default is no automatic UART ownership or GPIO reconfiguration.
  if (autoStart && !ssid.isEmpty() && validLocalHost() && deviceId.startsWith("node-")
      && !deviceToken.isEmpty()) beginUart();
}

void loop() {
  usbCommands();
  if (!uartStarted || ssid.isEmpty() || !validLocalHost() || deviceId.isEmpty() || deviceToken.isEmpty()) {
    delay(30); return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWiFiTry > 5000) {
      WiFi.begin(ssid.c_str(), wifiPass.c_str());
      lastWiFiTry = millis();
    }
    delay(30); return;
  }
  if (millis() - lastHeartbeat > 6000) { heartbeat(); lastHeartbeat = millis(); }
  if (millis() - lastPoll > 1300) { pollJobs(); lastPoll = millis(); }
  delay(10);
}
