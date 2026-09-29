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
  private adapterFactory: ExecutionServiceOptions['adapterFactory'];
  private sseManager?: ExecutionServiceOptions['sseManager'];
  private activeControllers = new Map<string, ExecutionController>();

  constructor(options: ExecutionServiceOptions) {
    this.planRepo = options.planRepo;
    this.stepRepo = options.stepRepo;
    this.adapterFactory = options.adapterFactory;
    this.sseManager = options.sseManager;
  }

  async approveAndStart(planId: string, userId: string): Promise<ApproveResult> {
    // 1. Optimistic Locking: only succeeds if current status is 'pending'
    const approved = await this.planRepo.approvePlan(planId);
    if (!approved) {
      return {
        success: false,
        status: 409,
        error: 'Plan is already approved, rejected, or expired',
      };
    }

    const planRow = await this.planRepo.getPlan(planId);
    if (!planRow) {
      return {
        success: false,
        status: 404,
        error: 'Plan not found',
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

    // 3. Setup Controller
    const controller = new ExecutionController({
      runner,
      steps,
      onStepUpdate: (stepId: string, state: StepState) => {
        // Update Step DB
        const dbId = stepDbIdMap.get(stepId);
        if (dbId && this.stepRepo) {
          this.stepRepo
            .updateStepStatus(dbId, state.status, state.output, state.error)
            .catch(() => {});
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

    // 5. Emit exec_done
    this.sseManager?.emitEvent(convId, 'exec_done', {
      planId,
      status: summary.status,
      pausedAtStepId: summary.pausedAtStepId,
      error: summary.error,
    });
  }

  async retryStep(planId: string, stepId: string): Promise<any> {
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      throw new Error(`No active execution controller for plan '${planId}'`);
    }
    return controller.retryStep(stepId);
  }

  async skipStep(planId: string, stepId: string): Promise<any> {
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      throw new Error(`No active execution controller for plan '${planId}'`);
    }
    return controller.skipStepAndContinue(stepId);
  }

  async stop(planId: string): Promise<any> {
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
