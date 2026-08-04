import { execFile } from "child_process";
import { logger } from "../logger";

// Wraps the OS lock/unlock capability. On Windows this calls
// user32!LockWorkStation via rundll32. A workstation cannot be programmatically
// UNLOCKED for security reasons, so "unlock" here is a logical state reset that
// drives robot/return behavior — the user physically unlocks the machine.
export class LockService {
  private locked = false;

  isLocked(): boolean {
    return this.locked;
  }

  lock(): Promise<void> {
    return new Promise((resolve) => {
      if (process.platform === "win32") {
        execFile(
          "rundll32.exe",
          ["user32.dll,LockWorkStation"],
          { windowsHide: true },
          (err) => {
            if (err) {
              logger.error("LockService: LockWorkStation failed", {
                error: err.message,
              });
            } else {
              logger.info("LockService: workstation locked");
            }
            this.locked = true;
            resolve();
          }
        );
      } else if (process.platform === "darwin") {
        execFile(
          "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession",
          ["-suspend"],
          () => {
            this.locked = true;
            resolve();
          }
        );
      } else {
        // Best effort on Linux; ignore failures.
        execFile("loginctl", ["lock-session"], () => {
          this.locked = true;
          resolve();
        });
      }
    });
  }

  // Logical unlock: marks state as unlocked so the decision loop and robot
  // return-to-dock flow behave correctly. The physical unlock is done by the user.
  unlock(): void {
    this.locked = false;
    logger.info("LockService: state reset to unlocked");
  }
}
