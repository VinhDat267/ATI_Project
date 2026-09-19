import { createContext, useContext, type ReactNode } from "react";
import type { Transport } from "../core/contracts.js";
import type { DraftStore } from "../core/draft.js";
import type { SessionController } from "../core/session.js";
import type { ControllerRegistry } from "../controllers/registry.js";

export { createControllerRegistry, type ControllerRegistry } from "../controllers/registry.js";

export interface AppHints {
  /** Planner suggestion for a needs_input run, when the transport has one. */
  suggestedPrompt(runId: string): string | null;
}

export interface AppContextValue {
  transport: Transport;
  session: SessionController;
  generation: number;
  email: string | null;
  drafts: DraftStore;
  hints: AppHints;
  mode: "fixture" | "live";
  controllers: ControllerRegistry;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: ReactNode;
}): ReactNode {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
