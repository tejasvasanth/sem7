import { execSync } from "child_process";
import { logger } from "../logger";
import { ContextState, PhoneData } from "../shared/types";
import { ActivitySample } from "./ActivityMonitor";

// Merges desktop activity + phone data into a single ContextState.
// Note: the AI-owned fields (confidence/decision/reason) are intentionally left
// undefined here — they are filled in later by the AI Engine response.
export class ContextMerger {
  private cachedSSID = "";
  private lastSSIDCheck = 0;

  merge(activity: ActivitySample, phone: PhoneData): ContextState {
    return {
      timestamp: Math.floor(Date.now() / 1000),
      idleTime: activity.idleTime,
      keyboardActive: activity.keyboardActive,
      mouseActive: activity.mouseActive,
      wifiSSID: this.getWifiSSID(),
      rssi: phone.rssi,
      phoneMoving: phone.phoneMoving,
      battery: phone.battery,
      charging: phone.charging,
    };
  }

  // Reads the current Wi-Fi SSID on Windows via netsh. Cached for 10s to avoid
  // spawning a process every second. Returns "" if unavailable.
  private getWifiSSID(): string {
    const now = Math.floor(Date.now() / 1000);
    if (now - this.lastSSIDCheck < 10 && this.cachedSSID) {
      return this.cachedSSID;
    }
    this.lastSSIDCheck = now;
    try {
      if (process.platform === "win32") {
        const out = execSync("netsh wlan show interfaces", {
          encoding: "utf-8",
          timeout: 3000,
          windowsHide: true,
        });
        const match = out.match(/^\s*SSID\s*:\s*(.+)$/m);
        this.cachedSSID = match ? match[1].trim() : "";
      } else if (process.platform === "darwin") {
        const out = execSync(
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I",
          { encoding: "utf-8", timeout: 3000 }
        );
        const match = out.match(/^\s*SSID:\s*(.+)$/m);
        this.cachedSSID = match ? match[1].trim() : "";
      } else {
        const out = execSync("iwgetid -r", {
          encoding: "utf-8",
          timeout: 3000,
        });
        this.cachedSSID = out.trim();
      }
    } catch (err) {
      logger.debug("ContextMerger: could not read Wi-Fi SSID", {
        error: (err as Error).message,
      });
      // keep last cached value
    }
    return this.cachedSSID;
  }
}
