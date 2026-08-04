import { logger } from "../logger";

export interface ActivitySample {
  idleTime: number; // seconds since last keyboard/mouse input
  keyboardActive: boolean; // key event within the last sample window
  mouseActive: boolean; // cursor moved within the last sample window
}

// Provides the current mouse cursor position. Injected from the Electron main
// process (screen.getCursorScreenPoint) so this class stays framework-agnostic
// and unit-testable.
export type CursorProvider = () => { x: number; y: number };

// Optional OS-level idle time in seconds (Electron powerMonitor). Used as a
// fallback/cross-check when native key hooks are unavailable.
export type SystemIdleProvider = () => number;

const ACTIVE_WINDOW_SEC = 2; // treat input in the last N seconds as "active"

export class ActivityMonitor {
  private lastKeyboardTs = 0;
  private lastMouseTs = 0;
  private lastCursor: { x: number; y: number } | null = null;
  private keyListener: { kill?: () => void } | null = null;

  constructor(
    private readonly cursorProvider?: CursorProvider,
    private readonly systemIdleProvider?: SystemIdleProvider
  ) {}

  start(): void {
    const now = this.nowSec();
    this.lastKeyboardTs = now;
    this.lastMouseTs = now;
    this.attachKeyboardListener();
  }

  private attachKeyboardListener(): void {
    try {
      // Lazy require: native module may be unavailable in some environments.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GlobalKeyboardListener } = require("node-global-key-listener");
      const listener = new GlobalKeyboardListener();
      listener.addListener((e: { state: string }) => {
        if (e.state === "DOWN") this.lastKeyboardTs = this.nowSec();
      });
      this.keyListener = listener;
      logger.info("ActivityMonitor: global keyboard listener attached");
    } catch (err) {
      logger.warn(
        "ActivityMonitor: keyboard listener unavailable, relying on system idle",
        { error: (err as Error).message }
      );
    }
  }

  // Called once per loop tick. Detects mouse movement via cursor position delta.
  sample(): ActivitySample {
    const now = this.nowSec();

    if (this.cursorProvider) {
      try {
        const pos = this.cursorProvider();
        if (
          this.lastCursor &&
          (pos.x !== this.lastCursor.x || pos.y !== this.lastCursor.y)
        ) {
          this.lastMouseTs = now;
        }
        this.lastCursor = pos;
      } catch {
        // ignore cursor read failures
      }
    }

    const lastInput = Math.max(this.lastKeyboardTs, this.lastMouseTs);
    let idleTime = Math.max(0, now - lastInput);

    // Cross-check with the OS idle timer when available; use the smaller value
    // (any signal of activity resets idle).
    if (this.systemIdleProvider) {
      try {
        const sysIdle = this.systemIdleProvider();
        idleTime = Math.min(idleTime, Math.max(0, Math.floor(sysIdle)));
      } catch {
        // ignore
      }
    }

    return {
      idleTime,
      keyboardActive: now - this.lastKeyboardTs <= ACTIVE_WINDOW_SEC,
      mouseActive: now - this.lastMouseTs <= ACTIVE_WINDOW_SEC,
    };
  }

  stop(): void {
    try {
      this.keyListener?.kill?.();
    } catch {
      // ignore
    }
    this.keyListener = null;
  }

  private nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
