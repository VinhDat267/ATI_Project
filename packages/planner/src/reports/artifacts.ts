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
  private artifacts = new Map<string, ReportArtifact>();

  createArtifact(params: {
    kind: ReportKind;
    sourceTool: string;
    sourceLabel: string;
    items: unknown[];
    renderedText: string;
    actor: { userId: string; workspaceId?: string | null };
  }): ReportArtifact {
    const id = `art_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
      createdAt: new Date().toISOString(),
    };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  getArtifact(id: string): ReportArtifact | undefined {
    return this.artifacts.get(id);
  }

  verifyArtifact(
    evidence: ReportEvidence,
    actor: { userId: string; workspaceId?: string | null }
  ): { valid: boolean; error?: string } {
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
