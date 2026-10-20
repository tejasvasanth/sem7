import asyncio
import json
import os
import time
import urllib.request
from bleak import BleakScanner

MOCK_FILE = os.path.abspath(r"C:\Users\akaas\Downloads\BOT\sem7\mocks\mock-phone.json")

BOT_TOKEN = "8832083833:AAGg-Byz8wuu_bd-KUK8shvUbL2uN5FID20"
CHAT_ID = "6130283037"

print("=" * 60)
print("[*] AirLock Telegram Cloud Bridge (Choice 2)")
print("[*] Tracking: Galaxy A17 5G")
print("[*] Automatically wakes bot via Telegram on lock!")
print("=" * 60)

last_seen = 0.0
smoothed_rssi = None
alpha = 0.4
bot_armed = False

def send_telegram(text):
    try:
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = json.dumps({"chat_id": CHAT_ID, "text": text}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            pass
        print(f"[TELEGRAM CLOUD] Sent to bot: '{text}'")
    except Exception as e:
        print(f"[!] Telegram notify error: {e}")

def detection_callback(device, adv):
    global last_seen, smoothed_rssi
    name = (device.name or adv.local_name or "").strip()

    if "galaxy" in name.lower() or "a17" in name.lower() or "akaash" in name.lower() or "4f:b3:e9:8f:14:df" in device.address.lower():
        last_seen = time.time()
        if smoothed_rssi is None:
            smoothed_rssi = float(adv.rssi)
        else:
            smoothed_rssi = (alpha * adv.rssi) + ((1 - alpha) * smoothed_rssi)

async def update_loop():
    global last_seen, smoothed_rssi, bot_armed
    scanner = BleakScanner(detection_callback)
    await scanner.start()
    print("[*] Scanner active. Tracking live Galaxy A17 5G signal...\n")

    try:
        while True:
            await asyncio.sleep(1.0)
            now = time.time()

            if smoothed_rssi is None:
                print(f"[{time.strftime('%H:%M:%S')}] Waiting for phone BLE advertisement packet...")
                continue

            time_since_seen = now - last_seen

            # If phone hasn't transmitted for > 8s, degrade signal
            if time_since_seen > 8.0:
                smoothed_rssi = max(-95.0, smoothed_rssi - 2.5)

            display_rssi = int(round(smoothed_rssi))

            # Only declare AWAY if:
            # 1. Signal is genuinely weak (<= -80 dBm) AND we haven't seen a packet for 8s, OR
            # 2. No packets for 12 seconds (phone physically departed or key turned off)
            is_away = (display_rssi <= -80 and time_since_seen >= 6.0) or (time_since_seen >= 12.0)

            # AUTOMATIC LAPTOP LOCK + BOT WAKEUP / STAND DOWN (DIRECT VIA HOTSPOT + TELEGRAM)
            if is_away and not bot_armed:
                bot_armed = True
                print("\n[!] USER AWAY -> LOCKING LAPTOP WORKSTATION & WAKING UP ESP32 BOT...")
                try:
                    os.system("rundll32.exe user32.dll,LockWorkStation")
                except Exception as e:
                    print(f"[!] Lock workstation failed: {e}")
                
                # Instant direct trigger over hotspot
                try:
                    urllib.request.urlopen("http://airlock-bot.local/start", timeout=1.5)
                    print("[DIRECT HOTSPOT] Sent /start to ESP32!")
                except Exception:
                    pass

            elif not is_away and bot_armed:
                bot_armed = False
                print("\n[+] USER RETURNED -> Laptop Safe -> TELLING BOT TO STAND DOWN...")
                try:
                    urllib.request.urlopen("http://airlock-bot.local/stop", timeout=1.5)
                    print("[DIRECT HOTSPOT] Sent /stop to ESP32!")
                except Exception:
                    pass

            data = {
                "rssi": display_rssi,
                "phoneMoving": is_away,
                "battery": 80,
                "charging": False
            }

            try:
                with open(MOCK_FILE, "w") as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                print(f"[!] File write error: {e}")

            status = "AWAY (Bot Armed & Scanning)" if is_away else f"NEARBY (Bot Dormant, seen {int(time_since_seen)}s ago)"
            print(f"[{time.strftime('%H:%M:%S')}] Signal: {display_rssi:>3} dBm  |  Status: {status}")
    finally:
        await scanner.stop()

if __name__ == "__main__":
    asyncio.run(update_loop())
