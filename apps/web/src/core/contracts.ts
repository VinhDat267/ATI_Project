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
} from "@wap/dsl/browser";
import type { Store } from "./store.js";
import type { Session } from "./session.js";
import type { Route } from "./navigation.js";

export type RunDetail = z.infer<typeof RunDetailSchema>;
export type EventPage = z.infer<typeof EventPageSchema>;
export type TracePage = z.infer<typeof TraceSchema>;
export type Reconciliation = z.infer<typeof ReconciliationSchema>;
export type Servers = z.infer<typeof ServerSummaryListSchema>;
export type CreateInput = z.input<typeof CreateRunSchema>;
export type DecisionInput = z.infer<typeof ApprovalDecisionSchema>;
export type RunAccepted = z.infer<typeof RunAcceptedSchema>;

export interface Transport {
  login(email: string, password: string, signal: AbortSignal): Promise<string>;
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
}

export interface FixtureCall {
  method: "GET" | "POST";
  path: string;
}

export type { Route, Session, Store };
