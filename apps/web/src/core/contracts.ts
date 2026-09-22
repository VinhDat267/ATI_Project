import { z } from "zod";
import {
  ApprovalDecisionSchema,
  CreateRunSchema,
  EventPageSchema,
  ReconciliationSchema,
  RunAcceptedSchema,
  RunDetailSchema,
  ServerSummaryListSchema,
  TraceSchema,
  AuthMeSchema,
} from "@wap/dsl/browser";
import type { Store } from "./store.js";
import type { Session } from "./session.js";
import type { Route } from "./navigation.js";

import type {
  PilotCreateRunInput,
  PilotCreateRunResponse,
  PilotRunDetailResponse,
  PilotApproveInput,
  PilotApproveResponse,
  PilotCatalogResponse,
} from "./pilot-contracts.js";

export type {
  PilotCreateRunInput,
  PilotCreateRunResponse,
  PilotRunDetailResponse,
  PilotApproveInput,
  PilotApproveResponse,
  PilotCatalogResponse,
};

export type RunDetail = z.infer<typeof RunDetailSchema>;
export type EventPage = z.infer<typeof EventPageSchema>;
export type TracePage = z.infer<typeof TraceSchema>;
export type Reconciliation = z.infer<typeof ReconciliationSchema>;
export type Servers = z.infer<typeof ServerSummaryListSchema>;
export type CreateInput = z.input<typeof CreateRunSchema>;
export type DecisionInput = z.infer<typeof ApprovalDecisionSchema>;
export type RunAccepted = z.infer<typeof RunAcceptedSchema>;
export type AuthMe = z.infer<typeof AuthMeSchema>;

export interface Transport {
  login(email: string, password: string, signal: AbortSignal): Promise<string>;
  me(signal: AbortSignal): Promise<AuthMe>;
  logout(signal: AbortSignal): Promise<void>;
  startOidcLogin(returnTo?: string): void;
  list(signal: AbortSignal): Promise<RunDetail[]>;
  servers(signal: AbortSignal): Promise<Servers>;
  create(input: CreateInput, signal: AbortSignal): Promise<RunAccepted>;
  detail(id: string, signal: AbortSignal): Promise<RunDetail>;
  events(id: string, since: number, signal: AbortSignal): Promise<EventPage>;
  decide(
    id: string,
    input: DecisionInput,
    signal: AbortSignal,
  ): Promise<RunDetail>;
  cancel(id: string, signal: AbortSignal): Promise<void>;
  trace(
    id: string,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<TracePage>;
  reconciliation(id: string, signal: AbortSignal): Promise<Reconciliation>;

  // Pilot v2 methods
  createPilotRun?(
    input: PilotCreateRunInput,
    signal: AbortSignal,
  ): Promise<PilotCreateRunResponse>;
  getPilotRun?(id: string, signal: AbortSignal): Promise<PilotRunDetailResponse>;
  approvePilotRun?(
    id: string,
    input: PilotApproveInput,
    signal: AbortSignal,
  ): Promise<PilotApproveResponse>;
  getPilotCatalog?(signal: AbortSignal): Promise<PilotCatalogResponse>;
}

export interface FixtureCall {
  method: "GET" | "POST";
  path: string;
}

export type { Route, Session, Store };
