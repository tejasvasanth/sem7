import type {
  AgentSettings,
  ContextState,
  RobotStatus,
} from "../../../shared/types";

export interface LockEvent {
  action: "LOCK" | "UNLOCK";
  trigger: "AUTO" | "MANUAL";
  reason?: string;
}

export interface AirLockBridge {
  getContext: () => Promise<ContextState | null>;
  getHistory: (n: number) => Promise<ContextState[]>;
  getLockHistory: (n: number) => Promise<unknown[]>;
  getSettings: () => Promise<AgentSettings | null>;
  getRobotStatus: () => Promise<RobotStatus | null>;
  updateSettings: (partial: Partial<AgentSettings>) => Promise<AgentSettings>;
  manualLock: () => Promise<{ ok: boolean }>;
  manualUnlock: () => Promise<{ ok: boolean }>;
  onContext: (callback: (data: ContextState) => void) => () => void;
  onRobotStatus: (callback: (data: RobotStatus) => void) => () => void;
  onLockEvent: (callback: (data: LockEvent) => void) => () => void;
}

declare global {
  interface Window {
    airlock: AirLockBridge;
  }
}
