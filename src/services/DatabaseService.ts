import * as fs from "fs";
import Database from "better-sqlite3";
import { logger } from "../logger";
import { DB_DIR, DB_PATH, DEFAULT_SETTINGS } from "../config";
import { AgentSettings, ContextState } from "../shared/types";

export interface LockHistoryRow {
  id: number;
  timestamp: number;
  action: "LOCK" | "UNLOCK";
  trigger: "AUTO" | "MANUAL";
  reason: string | null;
}

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
    this.seedSettings();
    logger.info("DatabaseService ready", { dbPath });
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sensor_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        idle_time INTEGER,
        keyboard_active INTEGER,
        mouse_active INTEGER,
        wifi_ssid TEXT,
        rssi INTEGER,
        phone_moving INTEGER,
        battery INTEGER,
        charging INTEGER,
        confidence REAL,
        decision TEXT,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS lock_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        trigger TEXT NOT NULL,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sensor_log_ts ON sensor_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_lock_history_ts ON lock_history(timestamp);
    `);
  }

  private seedSettings(): void {
    const existing = this.getSettings();
    // Only fill missing keys; never clobber user-set values.
    const merged: AgentSettings = { ...DEFAULT_SETTINGS, ...existing };
    this.saveSettings(merged);
  }

  insertSensorLog(ctx: ContextState): void {
    const stmt = this.db.prepare(`
      INSERT INTO sensor_log
        (timestamp, idle_time, keyboard_active, mouse_active, wifi_ssid, rssi,
         phone_moving, battery, charging, confidence, decision, reason)
      VALUES
        (@timestamp, @idleTime, @keyboardActive, @mouseActive, @wifiSSID, @rssi,
         @phoneMoving, @battery, @charging, @confidence, @decision, @reason)
    `);
    stmt.run({
      timestamp: ctx.timestamp,
      idleTime: ctx.idleTime,
      keyboardActive: ctx.keyboardActive ? 1 : 0,
      mouseActive: ctx.mouseActive ? 1 : 0,
      wifiSSID: ctx.wifiSSID,
      rssi: ctx.rssi,
      phoneMoving: ctx.phoneMoving ? 1 : 0,
      battery: ctx.battery,
      charging: ctx.charging ? 1 : 0,
      confidence: ctx.confidence ?? null,
      decision: ctx.decision ?? null,
      reason: ctx.reason ?? null,
    });
  }

  getHistory(n: number = 50): ContextState[] {
    const rows = this.db
      .prepare(`SELECT * FROM sensor_log ORDER BY id DESC LIMIT ?`)
      .all(n) as Record<string, unknown>[];
    return rows.map((r) => ({
      timestamp: r.timestamp as number,
      idleTime: r.idle_time as number,
      keyboardActive: !!(r.keyboard_active as number),
      mouseActive: !!(r.mouse_active as number),
      wifiSSID: (r.wifi_ssid as string) ?? "",
      rssi: r.rssi as number,
      phoneMoving: !!(r.phone_moving as number),
      battery: r.battery as number,
      charging: !!(r.charging as number),
      confidence: (r.confidence as number) ?? undefined,
      decision: (r.decision as ContextState["decision"]) ?? undefined,
      reason: (r.reason as string) ?? undefined,
    }));
  }

  insertLockHistory(
    action: "LOCK" | "UNLOCK",
    trigger: "AUTO" | "MANUAL",
    reason: string | null,
    timestamp: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO lock_history (timestamp, action, trigger, reason)
         VALUES (?, ?, ?, ?)`
      )
      .run(timestamp, action, trigger, reason);
  }

  getLockHistory(n: number = 50): LockHistoryRow[] {
    return this.db
      .prepare(`SELECT * FROM lock_history ORDER BY id DESC LIMIT ?`)
      .all(n) as LockHistoryRow[];
  }

  getSettings(): Partial<AgentSettings> {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as {
      key: string;
      value: string;
    }[];
    const out: Record<string, unknown> = {};
    for (const { key, value } of rows) {
      try {
        out[key] = JSON.parse(value);
      } catch {
        out[key] = value;
      }
    }
    return out as Partial<AgentSettings>;
  }

  saveSettings(settings: Partial<AgentSettings>): void {
    const upsert = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const tx = this.db.transaction((s: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(s)) {
        upsert.run(key, JSON.stringify(value));
      }
    });
    tx(settings as Record<string, unknown>);
  }

  close(): void {
    this.db.close();
  }
}
