import { randomUUID } from 'node:crypto';
import type { SlackSourceRepo } from '../../db/repositories/slack-source-repo.js';
import type { SlackInvalidationService } from './slack-invalidation-service.js';
import type { SlackPolicyEventConsumer } from './slack-policy-event-consumer.js';

export interface SlackInvalidationRunnerOptions {
  sweepIntervalMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  workerId?: string;
  onError?: (err: unknown, context: string) => void;
}

export interface InvalidationSweepStats {
  expiredSourcesPurged: number;
  policyEventsProcessed: number;
  rawIntentsProcessed: number;
  rawIntentsFailed: number;
  staleLeasesRecovered: number;
}

export class SlackInvalidationRunner {
  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly workerId: string;
  private readonly onError?: (err: unknown, context: string) => void;

  private running = false;
  private timerHandle: NodeJS.Timeout | null = null;
  private currentSweepPromise: Promise<InvalidationSweepStats> | null = null;

  constructor(
    private readonly sourceRepo: SlackSourceRepo,
    private readonly invalidationService: SlackInvalidationService,
    private readonly policyEventConsumer: SlackPolicyEventConsumer,
    options: SlackInvalidationRunnerOptions = {}
  ) {
    this.sweepIntervalMs = options.sweepIntervalMs ?? 5000;
    this.batchSize = options.batchSize ?? 50;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.workerId = options.workerId ?? `slack-runner-${randomUUID()}`;
    this.onError = options.onError;
  }

  isRunning(): boolean {
    return this.running;
  }

  getWorkerId(): string {
    return this.workerId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.timerHandle = setInterval(() => {
      this.tick().catch(err => {
        if (this.onError) {
          this.onError(err, 'interval_tick');
        }
      });
    }, this.sweepIntervalMs);

    if (this.timerHandle.unref) {
      this.timerHandle.unref();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }

    if (this.currentSweepPromise) {
      try {
        await this.currentSweepPromise;
      } catch {
        // ignore errors during shutdown
      }
    }
  }

  /**
   * Performs a single deterministic invalidation sweep cycle.
   */
  async tick(): Promise<InvalidationSweepStats> {
    if (this.currentSweepPromise) {
      return this.currentSweepPromise;
    }

    this.currentSweepPromise = this.executeSweep();
    try {
      return await this.currentSweepPromise;
    } finally {
      this.currentSweepPromise = null;
    }
  }

  private async executeSweep(): Promise<InvalidationSweepStats> {
    const stats: InvalidationSweepStats = {
      expiredSourcesPurged: 0,
      policyEventsProcessed: 0,
      rawIntentsProcessed: 0,
      rawIntentsFailed: 0,
      staleLeasesRecovered: 0,
    };

    // 1. Sweep retention TTL expired sources (raw erasure without live token)
    try {
      const expRes = await this.sourceRepo.purgeExpiredSources(this.batchSize);
      stats.expiredSourcesPurged = expRes.purgedCount;
    } catch (err) {
      if (this.onError) this.onError(err, 'purge_expired_sources');
    }

    // 2. Consume 02B policy events (consent revocation, provider updates)
    try {
      const polRes = await this.policyEventConsumer.consumePendingPolicyEvents(this.batchSize);
      stats.policyEventsProcessed = polRes.processedCount;
    } catch (err) {
      if (this.onError) this.onError(err, 'consume_policy_events');
    }

    // 3. Recover stale leases
    try {
      const recRes = await this.invalidationService.recoverStaleLeases();
      stats.staleLeasesRecovered = recRes.recoveredCount;
    } catch (err) {
      if (this.onError) this.onError(err, 'recover_stale_leases');
    }

    // 4. Claim and process RAW-ONLY invalidation intents
    // Invariant: Only 'slack_source_raw' target kinds are claimed and processed by 03B1.
    // Derived targets (chat_history_message, working_memory_entity, etc.) remain pending for 03B2.
    try {
      const rawIntents = await this.invalidationService.claimIntents(
        this.batchSize,
        this.workerId,
        this.leaseSeconds,
        'slack_source_raw'
      );

      for (const intent of rawIntents) {
        try {
          if (intent.purgeTarget) {
            await this.sourceRepo.purgeSourcesByTarget(intent.purgeTarget);
          }
          await this.invalidationService.completeIntent(intent.id);
          stats.rawIntentsProcessed++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.invalidationService.failIntent(intent.id, errMsg);
          stats.rawIntentsFailed++;
          if (this.onError) this.onError(err, `process_intent_${intent.id}`);
        }
      }
    } catch (err) {
      if (this.onError) this.onError(err, 'claim_intents');
    }

    return stats;
  }
}
