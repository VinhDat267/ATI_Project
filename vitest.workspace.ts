import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/tool-schemas',
  'packages/tool-adapters',
  'packages/planner',
  'packages/executor',
  'apps/chat-api',
  'apps/chat-web',
]);
