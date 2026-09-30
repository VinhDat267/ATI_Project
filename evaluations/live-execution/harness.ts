import { createHash } from 'node:crypto';
import { ExecutionController, StepRunner, isWriteTool, type AdapterExecutor, type StepState } from '@wap/executor';
import { validatePlan } from '@wap/planner';
import { ALL_TOOLS, type AllowedScope, type PlanResponse, type PlanStep } from '@wap/tool-schemas';

export interface LiveService {
  credentials: Record<string, string>;
  allowedScope: AllowedScope;
}

export interface LiveConfig {
  services: Record<string, LiveService>;
  /** Why a service is not enabled. */
  skipped: Record<string, string>;
}

const list = (value: string | undefined) => [...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];

/**
 * A service is enabled only with credentials and an explicit allowlist of the
 * resources it may touch. Missing either leaves it off, so a run cannot reach
 * a board, channel or repository nobody named.
 */
export function readLiveConfig(env: Record<string, string | undefined>): LiveConfig {
  const services: Record<string, LiveService> = {};
  const skipped: Record<string, string> = {};

  const boards = list(env.LIVE_TRELLO_BOARD_IDS);
  if (!env.TRELLO_API_KEY || !env.TRELLO_TOKEN) skipped.trello = 'TRELLO_API_KEY and TRELLO_TOKEN are required';
  else if (boards.length === 0) skipped.trello = 'LIVE_TRELLO_BOARD_IDS must list the board ids a run may use';
  else services.trello = { credentials: { apiKey: env.TRELLO_API_KEY, token: env.TRELLO_TOKEN }, allowedScope: { boards } };

  const channels = list(env.LIVE_SLACK_CHANNELS);
  if (!env.SLACK_BOT_TOKEN) skipped.slack = 'SLACK_BOT_TOKEN is required';
  else if (channels.length === 0) skipped.slack = 'LIVE_SLACK_CHANNELS must list the channel ids a run may use';
  else services.slack = { credentials: { botToken: env.SLACK_BOT_TOKEN }, allowedScope: { channels } };

  const repos = list(env.LIVE_GITHUB_REPOS);
  if (!env.GITHUB_TOKEN) skipped.github = 'GITHUB_TOKEN is required';
  else if (repos.length === 0) skipped.github = 'LIVE_GITHUB_REPOS must list the repositories a run may use';
  else if (!repos.every((repo) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))) skipped.github = 'LIVE_GITHUB_REPOS entries must be owner/name';
  else services.github = { credentials: { token: env.GITHUB_TOKEN }, allowedScope: { repos } };

  return { services, skipped };
}

/** The hash a reviewer approves; any edit to the plan changes it. */
export function planDigest(plan: PlanResponse): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

/** The steps that change something outside the platform. */
export function writeSteps(plan: PlanResponse): PlanStep[] {
  return plan.steps.filter((step) => isWriteTool(step.tool));
}

export interface ExecuteApprovedInput {
  plan: PlanResponse;
  /** Digest of the plan the reviewer saw. */
  approvedHash: string;
  /** Services enabled by readLiveConfig. */
  services: string[];
  getAdapter: (service: string) => AdapterExecutor | Promise<AdapterExecutor>;
  onStep?: (stepId: string, state: StepState) => void;
}

export interface ExecutionReport {
  status: string;
  pausedAtStepId?: string;
  steps: Array<{ id: string; tool: string; status: string; output?: any; error?: any }>;
}

/**
 * Runs exactly the reviewed plan through the real step runner and controller.
 * Nothing is executed unless the hash matches, every tool's service is
 * configured, and the plan still passes schema validation.
 */
export async function executeApproved(input: ExecuteApprovedInput): Promise<ExecutionReport> {
  const { plan, approvedHash, services, getAdapter, onStep } = input;
  const actual = planDigest(plan);
  if (actual !== approvedHash) {
    throw new Error(`Approved hash does not match the plan (plan is ${actual}); review the plan again before executing`);
  }
  const missing = [...new Set(plan.steps.map((step) => step.tool.split('.')[0]!))].filter((service) => !services.includes(service));
  if (missing.length) throw new Error(`Plan uses ${missing.join(', ')}, which is not configured for live execution`);
  const validation = validatePlan(JSON.stringify(plan), ALL_TOOLS.filter((tool) => services.includes(tool.service)));
  if (!validation.valid) throw new Error(`Plan failed validation: [${validation.layer}] ${validation.error}`);

  const states = new Map<string, StepState>(plan.steps.map((step) => [step.id, { stepId: step.id, status: 'pending' }]));
  const controller = new ExecutionController({
    runner: new StepRunner({ getAdapter }),
    steps: plan.steps,
    onStepUpdate: (stepId, state) => {
      states.set(stepId, state);
      onStep?.(stepId, state);
    },
  });
  const summary = await controller.runUntilPause();
  return {
    status: summary.status,
    pausedAtStepId: summary.pausedAtStepId,
    steps: plan.steps.map((step) => {
      const state = states.get(step.id)!;
      return { id: step.id, tool: step.tool, status: state.status, output: state.output, error: state.error };
    }),
  };
}
