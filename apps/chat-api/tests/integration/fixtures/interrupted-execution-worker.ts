import { getPool } from '../../../src/db/pool.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../../src/db/repositories/step-repo.js';
import { ExecutionService } from '../../../src/services/execution-service.js';

// Runs the real execution/persistence pipeline in a process the test can kill.
// Only the external service boundary is local: no provider write is made.
const pool = getPool({ connectionString: process.env.DATABASE_URL });
const service = new ExecutionService({
  planRepo: new PlanRepo(pool),
  stepRepo: new StepRepo(pool),
  convRepo: new ConversationRepo(pool),
  adapterFactory: {
    getAdapterForService: () => ({
      execute: async (tool: string, _args: unknown, options: { signal: AbortSignal }) => {
        if (tool === 'trello.create_card') {
          return { id: 'completed-before-crash', name: 'Completed', listId: 'test-list' };
        }
        process.send?.({ event: 'write-started' });
        await new Promise<void>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('Write interrupted')), { once: true });
        });
      },
    }),
  },
});

const result = await service.approveAndStart(process.env.TEST_PLAN_ID!, process.env.TEST_USER_ID!);
if (!result.success) throw new Error('Fixture plan approval failed');
