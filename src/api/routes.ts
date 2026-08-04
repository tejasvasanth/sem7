import express, { Express, Request, Response } from "express";
import { Server } from "http";
import { logger } from "../logger";
import { REST_PORT } from "../config";
import { AirLockAgent } from "../services/AirLockAgent";
import { DatabaseService } from "../services/DatabaseService";
import { AgentSettings } from "../shared/types";

// Express REST API exposed on port 3000. Consumed primarily by the AI Engine
// (Person 2) and useful for manual control/testing.
export function createApiServer(
  agent: AirLockAgent,
  db: DatabaseService
): { app: Express; listen: () => Server } {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: Math.floor(Date.now() / 1000) });
  });

  // Latest merged ContextState.
  app.get("/context", (_req: Request, res: Response) => {
    const ctx = agent.getLatestContext();
    if (!ctx) {
      res.status(503).json({ error: "No context sampled yet" });
      return;
    }
    res.json(ctx);
  });

  // Last N sensor records from SQLite.
  app.get("/history", (req: Request, res: Response) => {
    const n = Math.min(1000, Math.max(1, Number(req.query.n ?? 50)));
    res.json(db.getHistory(n));
  });

  // Manual lock: also fires RobotCommand{action:"GUARD"} via the agent.
  app.post("/lock", async (_req: Request, res: Response) => {
    try {
      await agent.manualLock("REST /lock");
      res.json({ ok: true, action: "LOCK" });
    } catch (err) {
      logger.error("POST /lock failed", { error: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Manual unlock: fires RobotCommand{action:"RETURN_TO_DOCK"}.
  app.post("/unlock", (_req: Request, res: Response) => {
    agent.manualUnlock("REST /unlock");
    res.json({ ok: true, action: "UNLOCK" });
  });

  // Update sensitivity / preferences.
  app.post("/settings", (req: Request, res: Response) => {
    const body = req.body as Partial<AgentSettings>;
    const updated = agent.updateSettings(body ?? {});
    res.json(updated);
  });

  app.get("/settings", (_req: Request, res: Response) => {
    res.json(agent.getSettings());
  });

  const listen = (): Server =>
    app.listen(REST_PORT, () => {
      logger.info("REST API listening", { port: REST_PORT });
    });

  return { app, listen };
}
