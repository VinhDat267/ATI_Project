import type { PlanRepo } from '../db/repositories/plan-repo.js';
import type { StepRepo } from '../db/repositories/step-repo.js';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { StepRunner, ExecutionController, type StepState } from '@wap/executor';
import type { PlanStep } from '@wap/tool-schemas';

export interface ApproveResult {
  success: boolean;
  status: number;
  error?: string;
  planId?: string;
}

export interface ExecutionServiceOptions {
  planRepo: PlanRepo;
  stepRepo?: StepRepo;
  convRepo?: {
    getConversation: (id: string) => Promise<any>;
  };
  credentialRepo?: CredentialRepo;
  adapterFactory: {
    getAdapterForService: (serviceName: string) => Promise<any> | any;
  };
  sseManager?: {
    emitEvent: (convId: string, eventName: string, data: any) => void;
  };
}

export class ExecutionService {
  private planRepo: PlanRepo;
  private stepRepo?: StepRepo;
  private convRepo?: ExecutionServiceOptions['convRepo'];
  private adapterFactory: ExecutionServiceOptions['adapterFactory'];
  private sseManager?: ExecutionServiceOptions['sseManager'];
  private activeControllers = new Map<string, ExecutionController>();

  constructor(options: ExecutionServiceOptions) {
    this.planRepo = options.planRepo;
    this.stepRepo = options.stepRepo;
    this.convRepo = options.convRepo;
    this.adapterFactory = options.adapterFactory;
    this.sseManager = options.sseManager;
  }

  getPlanRepo(): PlanRepo {
    return this.planRepo;
  }

  async approveAndStart(planId: string, userId: string): Promise<ApproveResult> {
    const planRow = await this.planRepo.getPlan(planId);
    if (!planRow) {
      return {
        success: false,
        status: 404,
        error: 'Plan not found',
      };
    }

    // Verify conversation ownership if convRepo is available
    if (this.convRepo) {
      const conv = await this.convRepo.getConversation(planRow.conv_id);
      if (!conv || conv.user_id !== userId) {
        return {
          success: false,
          status: 403,
          error: 'Forbidden: you do not own this plan',
        };
      }
    }

    // Check expiration
    if (planRow.expires_at && new Date(planRow.expires_at).getTime() < Date.now()) {
      return {
        success: false,
        status: 410,
        error: 'Plan has expired',
      };
    }

    // 1. Optimistic Locking: only succeeds if current status is 'pending' and not expired
    const approved = await this.planRepo.approvePlan(planId);
    if (!approved) {
      return {
        success: false,
        status: 409,
        error: 'Plan is already approved, rejected, or expired',
      };
    }

    const convId = planRow.conv_id;
    const planJson =
      typeof planRow.plan_json === 'string'
        ? JSON.parse(planRow.plan_json)
        : planRow.plan_json;
    const steps: PlanStep[] = planJson?.steps || [];

    // Emit exec_start
    this.sseManager?.emitEvent(convId, 'exec_start', { planId });

    // Launch background execution
    setImmediate(() => {
      this.executePlan(convId, planId, steps, userId).catch((err) => {
        this.sseManager?.emitEvent(convId, 'error', {
          planId,
          message: err?.message || 'Unexpected execution error',
        });
      });
    });

    return {
      success: true,
      status: 200,
      planId,
    };
  }

  private async executePlan(
    convId: string,
    planId: string,
    steps: PlanStep[],
    userId: string
  ): Promise<void> {
    // 1. Setup StepRunner
    const runner = new StepRunner({
      getAdapter: (serviceName: string) => {
        return this.adapterFactory.getAdapterForService(serviceName);
      },
    });

    // 2. Setup Step DB tracking and step DB IDs map
    const stepDbIdMap = new Map<string, string>();
    if (this.stepRepo) {
      for (const step of steps) {
        const created = await this.stepRepo.createStep({
          planId,
          stepId: step.id,
          tool: step.tool,
          argsJson: step.args || {},
          requestedBy: userId,
        });
        stepDbIdMap.set(step.id, created.id);
      }
    }

    let hasPersistenceFailure = false;
    const persistencePromises: Promise<any>[] = [];

    // 3. Setup Controller
    const controller = new ExecutionController({
      runner,
      steps,
      onStepUpdate: (stepId: string, state: StepState) => {
        // Update Step DB
        const dbId = stepDbIdMap.get(stepId);
        if (dbId && this.stepRepo) {
          const p = this.stepRepo
            .updateStepStatus(dbId, state.status, state.output, state.error)
            .catch((err) => {
              console.error('Failed to update step status in DB:', err);
              hasPersistenceFailure = true;
            });
          persistencePromises.push(p);
        }

        // Emit SSE exec_step
        this.sseManager?.emitEvent(convId, 'exec_step', {
          planId,
          stepId,
          status: state.status,
          output: state.output,
          error: state.error,
        });
      },
    });

    this.activeControllers.set(planId, controller);

    // 4. Run execution
    const summary = await controller.runUntilPause();

    // Wait for all DB step updates to complete
    await Promise.all(persistencePromises);

    const finalStatus = hasPersistenceFailure ? 'failed' : summary.status;
    const finalError = hasPersistenceFailure
      ? { message: 'Database step status persistence failed' }
      : summary.error;

    // Update Plan status in DB
    await this.planRepo.updatePlanStatus(planId, finalStatus).catch((err) => {
      console.error('Failed to update plan status in DB:', err);
      hasPersistenceFailure = true;
    });

    // 5. Emit exec_done with true durable status
    this.sseManager?.emitEvent(convId, 'exec_done', {
      planId,
      status: hasPersistenceFailure ? 'failed' : finalStatus,
      pausedAtStepId: summary.pausedAtStepId,
      error: finalError,
    });
  }

  async retryStep(planId: string, stepId: string, userId?: string): Promise<any> {
    const planRow = await this.planRepo.getPlan(planId);
    if (!planRow) {
      throw new Error(`Plan '${planId}' not found`);
    }
    if (this.convRepo && userId) {
      const conv = await this.convRepo.getConversation(planRow.conv_id);
      if (!conv || conv.user_id !== userId) {
        throw new Error('Forbidden: you do not own this execution');
      }
    }
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      throw new Error(`No active execution controller for plan '${planId}'`);
    }
    const convId = planRow?.conv_id || '';
    const summary = await controller.retryStep(stepId);
    if (convId && this.sseManager) {
      this.sseManager.emitEvent(convId, 'exec_done', {
        planId,
        status: summary.status,
        pausedAtStepId: summary.pausedAtStepId,
        error: summary.error,
      });
    }
    return summary;
  }

  async skipStep(planId: string, stepId: string, userId?: string): Promise<any> {
    const planRow = await this.planRepo.getPlan(planId);
    if (!planRow) {
      throw new Error(`Plan '${planId}' not found`);
    }
    if (this.convRepo && userId) {
      const conv = await this.convRepo.getConversation(planRow.conv_id);
      if (!conv || conv.user_id !== userId) {
        throw new Error('Forbidden: you do not own this execution');
      }
    }
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      throw new Error(`No active execution controller for plan '${planId}'`);
    }
    const convId = planRow?.conv_id || '';
    const summary = await controller.skipStepAndContinue(stepId);
    if (convId && this.sseManager) {
      this.sseManager.emitEvent(convId, 'exec_done', {
        planId,
        status: summary.status,
        pausedAtStepId: summary.pausedAtStepId,
        error: summary.error,
      });
    }
    return summary;
  }

  async stop(planId: string, userId?: string): Promise<any> {
    const planRow = await this.planRepo.getPlan(planId);
    if (!planRow) {
      throw new Error(`Plan '${planId}' not found`);
    }
    if (this.convRepo && userId) {
      const conv = await this.convRepo.getConversation(planRow.conv_id);
      if (!conv || conv.user_id !== userId) {
        throw new Error('Forbidden: you do not own this execution');
      }
    }
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      throw new Error(`No active execution controller for plan '${planId}'`);
    }
    return controller.stop();
  }

  getExecutionStatus(planId: string): { status: string; pausedStepId?: string } | null {
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      return null;
    }
    const states = controller.getAllStepStates();
    const allSteps = Object.values(states);
    const failed = allSteps.find((s) => s.status === 'failed' || s.status === 'unknown');
    if (failed) {
      return { status: 'partial', pausedStepId: failed.stepId };
    }
    const allDone = allSteps.every((s) => s.status === 'succeeded' || s.status === 'skipped');
    if (allDone) {
      return { status: 'completed' };
    }
    return { status: 'executing' };
  }
}
