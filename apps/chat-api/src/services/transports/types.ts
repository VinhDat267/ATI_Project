import type { AllowedScope } from '@wap/tool-schemas';

export type CredentialConfig = Record<string, unknown>;
export type Adapter = { execute: (toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }) => Promise<any> };

/** A resource the admin can tick into the allowed scope instead of typing its raw ID. */
export interface ScopeCandidate {
  id: string;
  label: string;
  /** Short, user-facing caveat, e.g. "bot not invited yet". */
  warning?: string;
}
export type ScopeCandidateResult =
  | { ok: true; items: ScopeCandidate[]; truncated: boolean }
  | { ok: false; status: number; code: string; error: string };

export interface ServiceTransport {
  id: string;
  createAdapter: (config: CredentialConfig, allowedScope: AllowedScope) => Adapter;
  checkConnection: (config: CredentialConfig, fetchFn: typeof fetch, signal: AbortSignal) => Promise<boolean>;
  /** Optional read-only discovery used by Settings to pick scope entries. */
  listScopeCandidates?: (config: CredentialConfig, fetchFn: typeof fetch, signal: AbortSignal) => Promise<ScopeCandidateResult>;
}
