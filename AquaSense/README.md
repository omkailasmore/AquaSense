# AquaSense - IoT water leakage monitoring (MVP)

ESP8266 + ZJ-S201 flow sensor -> HTTP POST -> Node/Express + SQLite -> React dashboard. Everything runs locally on your laptop; no cloud account, paid API, or API key is needed.

**What it can and cannot do.** One flow sensor measures flow only. The software never measures pressure and never pinpoints a leak's location. Alerts say "possible leakage" and come from simple threshold rules (no AI, no trained model).

## 1. Install (Windows, once)
Install Node.js LTS from nodejs.org and the Arduino IDE. In PowerShell:
```
cd aquasense\backend
npm install
cd ..\frontend
npm install
```

## 2. Run
Terminal 1 (backend):
```
cd aquasense\backend
npm start
```
Terminal 2 (dashboard):
```
cd aquasense\frontend
npm run dev
```
Open http://localhost:5173. Optional backend check: `cd backend` then `npm run smoke` (backend must be running).

## 3. Try the simulator (no hardware)
Top bar -> **Simulation**. Settings -> **Simulator** -> **Full demo cycle** (idle, normal, high flow, abnormal event, device offline, recovery). Use "Add 48 h sample history" for charts and "Generate test alert". Simulated data is stored with source `simulator`, labelled purple everywhere, and "Clear simulated data" never touches physical rows.

## 4. Connect the ESP8266
Your laptop and the ESP8266 must be on the **same Wi-Fi/LAN** (2.4 GHz). The backend listens on your LAN only; do not port-forward it.

1. Find the laptop IP: `ipconfig` -> "IPv4 Address" of your Wi-Fi adapter.
2. Allow it through Windows Firewall (admin PowerShell): `New-NetFirewallRule -DisplayName "AquaSense" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private`
3. Arduino IDE -> Preferences -> add `http://arduino.esp8266.com/stable/package_esp8266com_index.json` to Additional Boards URLs; Boards Manager -> install "esp8266".
4. Open `firmware\aquasense_esp8266\aquasense_esp8266.ino`. Edit `WIFI_SSID`, `WIFI_PASSWORD`, `BACKEND_HOST` (the IP from step 1).
5. Board: **NodeMCU 1.0 (ESP-12E Module)**, pick the COM port, Upload.
6. Serial Monitor at **115200** baud. You should see `[post] pulses=... -> HTTP 201`.
7. Dashboard -> **Physical device**. Status changes from "Awaiting device" once the first reading arrives. Blow gently through or run water through the sensor to see pulses.

## 5. Wiring assumptions (verify against your parts)
| Sensor wire | NodeMCU |
|---|---|
| Signal (yellow) | D2 (GPIO4) |
| GND (black) | GND |
| VCC (red) | see below |

The ESP8266 GPIOs are **3.3 V only**. The sensor is rated for 5 V and above, and its pulse output can reach the supply voltage. Safest: power it from VIN (5 V) and put a divider on the signal wire (10 kΩ from the signal wire to D2, and 20 kΩ from D2 to GND). If you have no resistors, some units work from 3V3; test that it counts. Confirm with the Serial Monitor.

**Pump and relay:** this software does not control them. Never connect the pump to a GPIO. If you add control later, the relay module's input is driven by the ESP, the pump's 12 V supply goes only through the relay contacts (with a flyback diode across the pump), grounds and active-HIGH/LOW logic must be tested with no water and no pump first. Pump control is disabled by default and has no dashboard button.

## 6. Calibration
450 pulses/L (flow Hz / 7.5) is only a starting estimate. Run water into a measuring jug, note pulses and litres, and enter them in **Sensor -> Calibrate** (or Settings). The backend recomputes flow from raw pulses, so changing it needs no firmware or frontend edit.

## 7. How detection works (all configurable in Settings)
- High flow above the maximum for N consecutive readings.
- Continuous flow at or above a threshold for a set time (a leak does not stop).
- Deviation from a moving-average baseline (needs about 20 flowing readings first; resets when the backend restarts).
- Device offline when no data arrives within the offline limit.
- Invalid or error readings (impossible flow, bad payload, sensor error).
Repeated alerts of one type update a single row (counter) instead of flooding the list.
A very slow drip may be below the sensor's minimum flow and produce no pulses at all.

## 8. API
`GET /api/health` `POST /api/readings` `GET /api/readings/latest` `GET /api/readings` `GET/PATCH /api/alerts` `GET /api/analytics/summary` `GET/PUT /api/settings` `GET /api/status` `GET /api/export/readings.csv|alerts.csv`.
Payload: `{"deviceId","pulseCount","intervalMs","flowRateLpm"?,"totalLitres"?,"rssi"?,"sensorStatus"}`. The ESP8266 has no clock, so the backend stamps the receive time. Optional: set `DEVICE_API_KEY` in `backend\.env` and `API_KEY` in the firmware.
Data lives in `backend\data\aquasense.db`.

## 9. Troubleshooting
- **Dashboard says backend unreachable:** backend not running (`npm start`).
- **Serial Monitor shows HTTP -1:** wrong `BACKEND_HOST`, firewall rule missing, different network, or backend not running.
- **HTTP 401:** API key mismatch. **HTTP 400/422:** payload invalid (message in the response).
- **Wi-Fi never connects:** 2.4 GHz only; re-check SSID/password.
- **Always zero flow:** check signal wire on D2, shared GND, sensor power, flow direction arrow, and that water actually moves through the sensor.
- **Flow too high or low:** calibrate pulses per litre.
- **"Device offline" while flowing:** the ESP lost Wi-Fi; check Serial Monitor.
