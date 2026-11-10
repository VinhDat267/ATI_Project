/**
 * Report Evidence Binding & Dispatch Guard (FLOW-01, F1 Grounding)
 * Prevents execution of ungrounded or tampered report plans.
 */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PlanResponse, ReportEvidence } from '@wap/tool-schemas';
import { requiresReportEvidence, reportOutputTargets } from '@wap/tool-schemas';

export interface ReportEvidenceValidationOptions {
  userId: string;
  workspaceId: string;
  expectedPlanHash?: string;
  planText?: string;
  observedArtifact?: {
    id: string;
    ownerUserId: string;
    workspaceId: string;
    contentHash: string;
  };
  enforceReportGrounding?: boolean;
  requestTexts?: string[];
}

/**
 * Checks whether a plan represents a factual report that requires ground truth verification.
 */
export function isReportPlan(plan: PlanResponse): boolean {
  if (plan.reportEvidence) return true;
  return requiresReportEvidence([plan.summary || '', plan.thinking || '']);
}

export async function validateReportEvidenceBinding(
  plan: PlanResponse,
  options: ReportEvidenceValidationOptions
): Promise<{ valid: boolean; error?: string }> {
  // 1. If plan claims to be or is detected as a report plan
  const targets = reportOutputTargets(plan.steps, {
    userTexts: options.requestTexts,
    workItemChoice: plan.reportEvidence?.workItemDisposition,
  });
  const detectedAsReport = !!plan.reportEvidence || (options.requestTexts?.length
    ? requiresReportEvidence(options.requestTexts) : isReportPlan(plan));

  if (detectedAsReport && targets.length > 0 && !plan.reportEvidence) {
    if (options.enforceReportGrounding) {
      return {
        valid: false,
        error: 'Missing report evidence: unverified report plan cannot be approved or dispatched without server-signed grounding.',
      };
    }
  }

  // 2. If canonical plan hash was provided, verify plan content has not been tampered with
  if (options.expectedPlanHash) {
    const serialized = options.planText || JSON.stringify(plan);
    const currentHash = createHash('sha256').update(serialized).digest('hex');
    let structurallyEqual = true;
    if (options.planText) {
      try {
        structurallyEqual = isDeepStrictEqual(JSON.parse(options.planText), plan);
      } catch {
        structurallyEqual = false;
      }
    }
    if (currentHash !== options.expectedPlanHash || !structurallyEqual) {
      return {
        valid: false,
        error: `Plan hash mismatch: content altered or tampered. Expected ${options.expectedPlanHash}, calculated ${currentHash}`,
      };
    }
  }

  // 3. If reportEvidence is attached, verify its integrity and authority
  if (plan.reportEvidence) {
    const evidence: ReportEvidence = plan.reportEvidence;

    // Check step existence
    const targetStep = plan.steps.find((s) => s.id === evidence.stepId);
    if (!targetStep) {
      return {
        valid: false,
        error: `Invalid report evidence: target step '${evidence.stepId}' does not exist in plan`,
      };
    }

    // Check step argument existence
    const stepArgValue = targetStep.args?.[evidence.argument];
    if (typeof stepArgValue !== 'string') {
      return {
        valid: false,
        error: `Invalid report evidence: step argument '${evidence.argument}' is missing or not a string`,
      };
    }

    // Verify hash of step argument content against evidence contentHash
    const computedArgHash = createHash('sha256').update(stepArgValue).digest('hex');
    if (computedArgHash !== evidence.contentHash) {
      return {
        valid: false,
        error: `Content altered or tampered: step argument '${evidence.argument}' hash does not match reportEvidence contentHash`,
      };
    }
    for (const target of targets) {
      const value = plan.steps.find((step) => step.id === target.stepId)!.args[target.argument];
      if (typeof value !== 'string' || createHash('sha256').update(value).digest('hex') !== evidence.contentHash) {
        return { valid: false, error: `Unverified report content in step '${target.stepId}' argument '${target.argument}'` };
      }
    }

    // Verify against server-side observation artifact if provided
    if (!options.observedArtifact || options.observedArtifact.id !== evidence.artifactId) {
      return {
        valid: false,
        error: `Unverified observation artifact: observation not found on server for artifactId '${evidence.artifactId}'`,
      };
    }

    const artifact = options.observedArtifact;

    // Verify actor ownership
    if (artifact.ownerUserId !== options.userId) {
      return {
        valid: false,
        error: `Ownership mismatch: artifact '${artifact.id}' belongs to user '${artifact.ownerUserId}', unauthorized artifact for '${options.userId}'`,
      };
    }

    // Verify workspace ownership
    if (artifact.workspaceId !== options.workspaceId) {
      return {
        valid: false,
        error: `Workspace mismatch: artifact '${artifact.id}' belongs to workspace '${artifact.workspaceId}', not '${options.workspaceId}'`,
      };
    }

    // Verify content hash match with observation
    if (artifact.contentHash !== evidence.contentHash) {
      return {
        valid: false,
        error: `Content hash mismatch: server observation hash differs from plan reportEvidence`,
      };
    }
  }

  return { valid: true };
}
