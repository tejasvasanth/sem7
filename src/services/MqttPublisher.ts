import mqtt, { MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { logger } from "../logger";
import { TOPICS } from "../config";
import { ContextState, RobotCommand, RobotStatus } from "../shared/types";

// Publishes ContextState + RobotCommand to MQTT and subscribes to robot status.
// If the broker is unavailable, every publish is logged and dropped — never throws.
export class MqttPublisher extends EventEmitter {
  private client: MqttClient | null = null;
  private connected = false;
  private brokerUrl: string;
  private lastRobotStatus: RobotStatus | null = null;

  constructor(brokerUrl: string) {
    super();
    this.brokerUrl = brokerUrl;
  }

  connect(): void {
    this.teardown();
    try {
      const client = mqtt.connect(this.brokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 4000,
      });

      client.on("connect", () => {
        this.connected = true;
        logger.info("MqttPublisher: connected", { broker: this.brokerUrl });
        client.subscribe(TOPICS.robotStatus, (err) => {
          if (err) {
            logger.warn("MqttPublisher: subscribe failed", {
              topic: TOPICS.robotStatus,
              error: err.message,
            });
          }
        });
        this.emit("connected");
      });

      client.on("reconnect", () =>
        logger.debug("MqttPublisher: reconnecting...")
      );
      client.on("close", () => {
        if (this.connected) logger.warn("MqttPublisher: connection closed");
        this.connected = false;
      });
      client.on("error", (err) => {
        logger.warn("MqttPublisher: error", { error: err.message });
      });

      client.on("message", (topic, payload) => {
        if (topic === TOPICS.robotStatus) {
          try {
            const status = JSON.parse(payload.toString()) as RobotStatus;
            this.lastRobotStatus = status;
            this.emit("robotStatus", status);
          } catch (err) {
            logger.warn("MqttPublisher: bad robot status payload", {
              error: (err as Error).message,
            });
          }
        }
      });

      this.client = client;
    } catch (err) {
      logger.warn("MqttPublisher: could not initialize client", {
        error: (err as Error).message,
      });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLastRobotStatus(): RobotStatus | null {
    return this.lastRobotStatus;
  }

  publishContext(ctx: ContextState): void {
    this.publish(TOPICS.context, ctx);
  }

  publishRobotCommand(cmd: RobotCommand): void {
    this.publish(TOPICS.robotCommand, cmd);
  }

  private publish(topic: string, obj: unknown): void {
    const payload = JSON.stringify(obj);
    if (!this.client || !this.connected) {
      logger.warn("MqttPublisher: broker unavailable, dropped message", {
        topic,
        payload,
      });
      return;
    }
    this.client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) {
        logger.warn("MqttPublisher: publish failed", {
          topic,
          error: err.message,
        });
      }
    });
  }

  setBrokerUrl(url: string): void {
    if (url && url !== this.brokerUrl) {
      this.brokerUrl = url;
      logger.info("MqttPublisher: broker URL changed, reconnecting", { url });
      this.connect();
    }
  }

  private teardown(): void {
    try {
      this.client?.end(true);
    } catch {
      // ignore
    }
    this.client = null;
    this.connected = false;
  }

  close(): void {
    this.teardown();
  }
}
