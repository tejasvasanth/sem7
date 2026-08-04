import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  powerMonitor,
  Notification,
} from "electron";
import * as path from "path";
import { Server } from "http";
import { logger } from "./logger";
import { DatabaseService } from "./services/DatabaseService";
import { ActivityMonitor } from "./services/ActivityMonitor";
import { PhoneDataReader } from "./services/PhoneDataReader";
import { ContextMerger } from "./services/ContextMerger";
import { LockService } from "./services/LockService";
import { MqttPublisher } from "./services/MqttPublisher";
import { AiClient } from "./services/AiClient";
import { AirLockAgent } from "./services/AirLockAgent";
import { createApiServer } from "./api/routes";
import { createTray } from "./ui/tray";
import { AI_PREDICT_URL } from "./config";
import { ContextState, RobotStatus } from "./shared/types";

let mainWindow: BrowserWindow | null = null;
let agent: AirLockAgent | null = null;
let db: DatabaseService | null = null;
let apiServer: Server | null = null;
let mqtt: MqttPublisher | null = null;
let lastIntruderNotifyTs = 0;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "AirLock Desktop Agent",
    webPreferences: {
      preload: path.join(__dirname, "ui", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "ui", "renderer", "index.html"));

  mainWindow.on("close", (e) => {
    // Hide to tray instead of quitting.
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
    mainWindow.show();
  }
}

function wireServices(): void {
  db = new DatabaseService();
  const settings = { ...db.getSettings() };

  const activity = new ActivityMonitor(
    () => screen.getCursorScreenPoint(),
    () => powerMonitor.getSystemIdleTime()
  );
  const phone = new PhoneDataReader();
  const merger = new ContextMerger();
  const lock = new LockService();
  mqtt = new MqttPublisher(
    settings.mqttBrokerUrl ?? "mqtt://localhost:1883"
  );
  const ai = new AiClient(AI_PREDICT_URL);

  agent = new AirLockAgent(activity, phone, merger, lock, mqtt, ai, db);

  // Forward events to the renderer + system notifications.
  agent.on("context", (ctx: ContextState) =>
    sendToRenderer("context", ctx)
  );
  agent.on("robotStatus", (status: RobotStatus) => {
    sendToRenderer("robotStatus", status);
    maybeNotifyIntruder(status);
  });
  agent.on("lock", (e: { trigger: string; reason?: string }) => {
    notify("AirLock — Locked", `${e.trigger} lock. ${e.reason ?? ""}`);
    sendToRenderer("lockEvent", { action: "LOCK", ...e });
  });
  agent.on("unlock", (e: { trigger: string; reason?: string }) => {
    notify("AirLock — Unlocked", `${e.trigger} unlock. ${e.reason ?? ""}`);
    sendToRenderer("lockEvent", { action: "UNLOCK", ...e });
  });

  agent.start();

  const { listen } = createApiServer(agent, db);
  apiServer = listen();
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (err) {
    logger.warn("notify failed", { error: (err as Error).message });
  }
}

function maybeNotifyIntruder(status: RobotStatus): void {
  const now = Math.floor(Date.now() / 1000);
  if (status.intruderDetected && now - lastIntruderNotifyTs > 15) {
    lastIntruderNotifyTs = now;
    notify(
      "AirLock — Intruder detected!",
      `Robot is ${status.state}. Distance: ${status.distanceToNearestObject}cm`
    );
  }
}

function registerIpc(): void {
  ipcMain.handle("get-context", () => agent?.getLatestContext() ?? null);
  ipcMain.handle("get-history", (_e, n: number) => db?.getHistory(n ?? 50) ?? []);
  ipcMain.handle("get-lock-history", (_e, n: number) =>
    db?.getLockHistory(n ?? 50) ?? []
  );
  ipcMain.handle("get-settings", () => agent?.getSettings() ?? null);
  ipcMain.handle("get-robot-status", () => agent?.getRobotStatus() ?? null);
  ipcMain.handle("update-settings", (_e, partial) =>
    agent?.updateSettings(partial ?? {})
  );
  ipcMain.handle("manual-lock", async () => {
    await agent?.manualLock("UI manual lock");
    return { ok: true };
  });
  ipcMain.handle("manual-unlock", () => {
    agent?.manualUnlock("UI manual unlock");
    return { ok: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    registerIpc();
    wireServices();
    createTray(
      () => mainWindow?.show(),
      async () => agent?.manualLock("Tray lock"),
      () => {
        (app as unknown as { isQuitting?: boolean }).isQuitting = true;
        app.quit();
      }
    );

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  // Keep running in the tray on all platforms.
});

app.on("before-quit", () => {
  logger.info("Shutting down AirLock Desktop Agent");
  try {
    agent?.stop();
    apiServer?.close();
    db?.close();
  } catch (err) {
    logger.warn("shutdown error", { error: (err as Error).message });
  }
});
