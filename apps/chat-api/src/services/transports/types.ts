import type { AllowedScope } from '@wap/tool-schemas';

export type CredentialConfig = Record<string, unknown>;
export type Adapter = { execute: (toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }) => Promise<any> };
export interface ServiceTransport {
  id: string;
  createAdapter: (config: CredentialConfig, allowedScope: AllowedScope) => Adapter;
  checkConnection: (config: CredentialConfig, fetchFn: typeof fetch, signal: AbortSignal) => Promise<boolean>;
}
