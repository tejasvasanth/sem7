import * as fs from "fs";
import { logger } from "../logger";
import { MOCK_PHONE_PATH } from "../config";
import { PhoneData } from "../shared/types";

// Reads simulated phone sensor data from mock-phone.json. At integration time
// this class is swapped for a real BLE/WebSocket reader — the rest of the app
// only depends on read().
export class PhoneDataReader {
  private lastGood: PhoneData = {
    rssi: -90,
    phoneMoving: false,
    battery: 0,
    charging: false,
  };

  constructor(private readonly mockPath: string = MOCK_PHONE_PATH) {}

  read(): PhoneData {
    try {
      const raw = fs.readFileSync(this.mockPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PhoneData>;
      this.lastGood = {
        rssi: typeof parsed.rssi === "number" ? parsed.rssi : this.lastGood.rssi,
        phoneMoving: !!parsed.phoneMoving,
        battery:
          typeof parsed.battery === "number"
            ? parsed.battery
            : this.lastGood.battery,
        charging: !!parsed.charging,
        accelerometer: parsed.accelerometer,
      };
      return this.lastGood;
    } catch (err) {
      logger.warn("PhoneDataReader: falling back to last known values", {
        error: (err as Error).message,
        path: this.mockPath,
      });
      // Treat unreadable phone as "far away" so we fail safe (toward locking).
      return this.lastGood;
    }
  }
}
