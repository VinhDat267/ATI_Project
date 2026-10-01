import { getPool } from '../../../src/db/pool.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../../src/db/repositories/step-repo.js';
import { ExecutionService } from '../../../src/services/execution-service.js';

// The parent kills this real executor after the second write has started.
// Only the provider boundary is local; approval and progress use PostgreSQL.
const pool = getPool({ connectionString: process.env.DATABASE_URL });
const calls: string[] = [];
const service = new ExecutionService({
  planRepo: new PlanRepo(pool), stepRepo: new StepRepo(pool), convRepo: new ConversationRepo(pool),
  adapterFactory: { getAdapterForService: () => ({
    execute: async (tool: string, _args: unknown, options: { signal: AbortSignal }) => {
      calls.push(tool);
      if (tool === 'trello.create_card') return { id: 'created-before-crash', name: 'Preserved card' };
      process.send?.({ event: 'write-started', calls });
      await new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Write aborted')), { once: true });
      });
    },
  }) },
});
const result = await service.approveAndStart(process.env.TEST_PLAN_ID!, process.env.TEST_USER_ID!);
if (!result.success) throw new Error('Fixture approval failed');
