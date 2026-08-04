import * as fs from "fs";
import * as path from "path";
import { createLogger, format, transports, Logger } from "winston";
import { LOG_DIR } from "./config";

fs.mkdirSync(LOG_DIR, { recursive: true });

export const logger: Logger = createLogger({
  level: process.env.AIRLOCK_LOG_LEVEL ?? "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.splat(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `${timestamp} [${level.toUpperCase()}] ${message}${rest}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(LOG_DIR, "airlock.log"),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});
