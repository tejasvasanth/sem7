import { logger } from "../logger";
import { AI_PREDICT_URL } from "../config";
import { ContextState, Decision } from "../shared/types";

export interface PredictionResult {
  decision: Decision;
  confidence?: number;
  reason?: string;
  source: "AI" | "LOCAL";
}

// Talks to the AI Engine (Person 2) over REST. If unreachable, callers fall back
// to local rules — this client never throws, it returns null on failure.
export class AiClient {
  constructor(private readonly url: string = AI_PREDICT_URL) {}

  async predict(ctx: ContextState): Promise<PredictionResult | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ctx),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn("AiClient: non-OK response", { status: res.status });
        return null;
      }
      const data = (await res.json()) as Partial<ContextState>;
      if (!data.decision) {
        logger.warn("AiClient: response missing decision");
        return null;
      }
      return {
        decision: data.decision,
        confidence: data.confidence,
        reason: data.reason,
        source: "AI",
      };
    } catch (err) {
      logger.debug("AiClient: AI Engine unreachable", {
        error: (err as Error).message,
      });
      return null;
    }
  }
}
