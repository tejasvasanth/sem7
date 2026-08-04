import { EventEmitter } from "events";
import { logger } from "../logger";
import { DEFAULT_SETTINGS, LOOP_INTERVAL_MS } from "../config";
import {
  AgentSettings,
  ContextState,
  Decision,
  RobotCommand,
  RobotStatus,
} from "../shared/types";
import { ActivityMonitor } from "./ActivityMonitor";
import { PhoneDataReader } from "./PhoneDataReader";
import { ContextMerger } from "./ContextMerger";
import { LockService } from "./LockService";
import { MqttPublisher } from "./MqttPublisher";
import { AiClient } from "./AiClient";
import { DatabaseService } from "./DatabaseService";

// Central coordinator. Runs the 1s sense→decide→act loop and exposes the actions
// used by both the REST API and the Electron UI.
export class AirLockAgent extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private settings: AgentSettings;
  private latestContext: ContextState | null = null;

  constructor(
    private readonly activity: ActivityMonitor,
    private readonly phone: PhoneDataReader,
    private readonly merger: ContextMerger,
    private readonly lock: LockService,
    private readonly mqtt: MqttPublisher,
    private readonly ai: AiClient,
    private readonly db: DatabaseService
  ) {
    super();
    this.settings = { ...DEFAULT_SETTINGS, ...db.getSettings() };
    this.mqtt.on("robotStatus", (s: RobotStatus) =>
      this.emit("robotStatus", s)
    );
  }

  start(): void {
    this.activity.start();
    this.mqtt.setBrokerUrl(this.settings.mqttBrokerUrl);
    this.mqtt.connect();
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        logger.error("AirLockAgent: tick failed", { error: err.message })
      );
    }, LOOP_INTERVAL_MS);
    logger.info("AirLockAgent: started", { settings: this.settings });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.activity.stop();
    this.mqtt.close();
  }

  getLatestContext(): ContextState | null {
    return this.latestContext;
  }

  getSettings(): AgentSettings {
    return { ...this.settings };
  }

  getRobotStatus(): RobotStatus | null {
    return this.mqtt.getLastRobotStatus();
  }

  updateSettings(partial: Partial<AgentSettings>): AgentSettings {
    // Map a 1-5 sensitivity level onto thresholds if provided (higher = locks sooner).
    if (typeof partial.sensitivityLevel === "number") {
      const level = Math.min(5, Math.max(1, Math.round(partial.sensitivityLevel)));
      partial.idleThreshold = partial.idleThreshold ?? 120 - level * 20; // 100..20s
      partial.rssiThreshold = partial.rssiThreshold ?? -85 + level * 2; // -83..-75
      partial.sensitivityLevel = level;
    }
    this.settings = { ...this.settings, ...partial };
    this.db.saveSettings(this.settings);
    this.mqtt.setBrokerUrl(this.settings.mqttBrokerUrl);
    logger.info("AirLockAgent: settings updated", { settings: this.settings });
    this.emit("settings", this.settings);
    return this.getSettings();
  }

  // ---- Core loop ----------------------------------------------------------

  private async tick(): Promise<void> {
    const activity = this.activity.sample();
    const phone = this.phone.read();
    const ctx = this.merger.merge(activity, phone);

    // Ask the AI Engine; fall back to local rules if unavailable or disabled.
    let decision: Decision = "WAIT";
    let confidence: number | undefined;
    let reason: string | undefined;
    let source: "AI" | "LOCAL" = "LOCAL";

    if (this.settings.useAiEngine) {
      const prediction = await this.ai.predict(ctx);
      if (prediction) {
        decision = prediction.decision;
        confidence = prediction.confidence;
        reason = prediction.reason;
        source = "AI";
      }
    }

    if (source === "LOCAL") {
      const local = this.localRule(ctx);
      decision = local.decision;
      reason = local.reason;
      confidence = local.confidence;
    }

    // Attach AI-owned fields for pass-through only.
    ctx.decision = decision;
    ctx.confidence = confidence;
    ctx.reason = reason;

    this.latestContext = ctx;
    this.db.insertSensorLog(ctx);
    this.mqtt.publishContext(ctx);
    this.emit("context", ctx);

    await this.applyDecision(decision, reason, source);
  }

  // Local fallback rule per the God File: idle > threshold AND rssi < threshold.
  private localRule(ctx: ContextState): {
    decision: Decision;
    reason: string;
    confidence: number;
  } {
    const away = ctx.rssi < this.settings.rssiThreshold;
    const idle = ctx.idleTime > this.settings.idleThreshold;

    if (idle && away) {
      return {
        decision: "LOCK",
        confidence: 80,
        reason: `Local rule: idle ${ctx.idleTime}s > ${this.settings.idleThreshold}s and RSSI ${ctx.rssi} < ${this.settings.rssiThreshold}`,
      };
    }
    if (!away && ctx.idleTime < 5 && this.lock.isLocked()) {
      return {
        decision: "UNLOCK",
        confidence: 70,
        reason: "Local rule: user active and phone nearby",
      };
    }
    return {
      decision: "WAIT",
      confidence: 60,
      reason: "Local rule: conditions not met",
    };
  }

  private async applyDecision(
    decision: Decision,
    reason: string | undefined,
    source: "AI" | "LOCAL"
  ): Promise<void> {
    if (decision === "LOCK" && !this.lock.isLocked()) {
      await this.lock.lock();
      this.emitRobotCommand("GUARD");
      this.db.insertLockHistory(
        "LOCK",
        "AUTO",
        reason ?? source,
        this.nowSec()
      );
      this.emit("lock", { trigger: "AUTO", reason });
    } else if (decision === "UNLOCK" && this.lock.isLocked()) {
      this.lock.unlock();
      this.emitRobotCommand("RETURN_TO_DOCK");
      this.db.insertLockHistory(
        "UNLOCK",
        "AUTO",
        reason ?? source,
        this.nowSec()
      );
      this.emit("unlock", { trigger: "AUTO", reason });
    }
  }

  // ---- Manual actions (called by REST + UI) -------------------------------

  async manualLock(reason = "Manual lock"): Promise<void> {
    await this.lock.lock();
    this.emitRobotCommand("GUARD");
    this.db.insertLockHistory("LOCK", "MANUAL", reason, this.nowSec());
    this.emit("lock", { trigger: "MANUAL", reason });
  }

  manualUnlock(reason = "Manual unlock"): void {
    this.lock.unlock();
    this.emitRobotCommand("RETURN_TO_DOCK");
    this.db.insertLockHistory("UNLOCK", "MANUAL", reason, this.nowSec());
    this.emit("unlock", { trigger: "MANUAL", reason });
  }

  private emitRobotCommand(action: RobotCommand["action"]): void {
    const cmd: RobotCommand = { timestamp: this.nowSec(), action };
    this.mqtt.publishRobotCommand(cmd);
  }

  private nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
