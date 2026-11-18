/**
 * Report Artifact Storage & Binding Verification (FLOW-01, F1 Grounding)
 */

import { createHash, randomUUID } from 'node:crypto';
import type { ReportEvidence, ReportKind } from '@wap/tool-schemas';

export interface ReportArtifact {
  id: string;
  kind: ReportKind;
  sourceTool: string;
  sourceLabel: string;
  actorUserId: string;
  workspaceId: string;
  items: unknown[];
  renderedText: string;
  contentHash: string;
  createdAt: string;
}

export class ReportArtifactStore {
  static readonly MAX_ARTIFACTS = 500;
  static readonly TTL_MS = 2 * 60 * 60 * 1000;

  private artifacts = new Map<string, ReportArtifact>();
  private timestamps = new Map<string, number>();
  private readonly maxArtifacts: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options?: { maxArtifacts?: number; ttlMs?: number; now?: () => number }) {
    this.maxArtifacts = options?.maxArtifacts ?? ReportArtifactStore.MAX_ARTIFACTS;
    this.ttlMs = options?.ttlMs ?? ReportArtifactStore.TTL_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  private pruneExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, createdAtMs] of this.timestamps) {
      if (createdAtMs < cutoff) {
        this.timestamps.delete(id);
        this.artifacts.delete(id);
      } else {
        // Insertion order is monotonic under real clocks; still continue in case test clocks step non-monotonically.
      }
    }
  }

  createArtifact(params: {
    kind: ReportKind;
    sourceTool: string;
    sourceLabel: string;
    items: unknown[];
    renderedText: string;
    actor: { userId: string; workspaceId?: string | null };
  }): ReportArtifact {
    this.pruneExpired();
    const nowMs = this.now();
    const id = `art_${nowMs}_${randomUUID().slice(0, 8)}`;
    const contentHash = createHash('sha256').update(params.renderedText).digest('hex');
    const artifact: ReportArtifact = {
      id,
      kind: params.kind,
      sourceTool: params.sourceTool,
      sourceLabel: params.sourceLabel,
      actorUserId: params.actor.userId,
      workspaceId: params.actor.workspaceId ?? 'default',
      items: params.items,
      renderedText: params.renderedText,
      contentHash,
      createdAt: new Date(nowMs).toISOString(),
    };
    while (this.artifacts.size >= this.maxArtifacts) {
      const oldestKey = this.artifacts.keys().next().value;
      if (oldestKey === undefined) break;
      this.artifacts.delete(oldestKey);
      this.timestamps.delete(oldestKey);
    }
    this.artifacts.set(id, artifact);
    this.timestamps.set(id, nowMs);
    return artifact;
  }

  getArtifact(id: string): ReportArtifact | undefined {
    this.pruneExpired();
    return this.artifacts.get(id);
  }

  verifyArtifact(
    evidence: ReportEvidence,
    actor: { userId: string; workspaceId?: string | null }
  ): { valid: boolean; error?: string } {
    this.pruneExpired();
    const artifact = this.artifacts.get(evidence.artifactId);
    if (!artifact) {
      return { valid: false, error: `Observation artifact '${evidence.artifactId}' not found` };
    }

    if (artifact.actorUserId !== actor.userId) {
      return { valid: false, error: `Actor mismatch: artifact belongs to '${artifact.actorUserId}', not '${actor.userId}'` };
    }

    const expectedWs = actor.workspaceId ?? 'default';
    if (artifact.workspaceId !== expectedWs) {
      return { valid: false, error: `Workspace mismatch: artifact belongs to '${artifact.workspaceId}', not '${expectedWs}'` };
    }

    if (artifact.contentHash !== evidence.contentHash) {
      return { valid: false, error: `Content hash mismatch for artifact '${evidence.artifactId}'` };
    }

    if (artifact.kind !== evidence.kind) {
      return { valid: false, error: `Kind mismatch: expected '${evidence.kind}', found '${artifact.kind}'` };
    }

    return { valid: true };
  }
}
