import type pg from 'pg';
import { isUuid } from '../db/repositories/uuid.js';
import type { ConversationRow, ConversationRepo } from '../db/repositories/conversation-repo.js';

export class ConversationAccessDeniedError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status = 404, message = 'Conversation not found', code = 'CONVERSATION_NOT_FOUND') {
    super(message);
    this.name = 'ConversationAccessDeniedError';
    this.status = status;
    this.code = code;
  }
}

export interface ConversationAccessOptions {
  legacyNonOwnerStatus?: 403 | 404;
}

export interface ConversationAccessContext {
  pool?: pg.Pool | pg.PoolClient;
  convRepo?: Pick<ConversationRepo, 'getConversation'>;
}

export interface PlanAccessContext extends ConversationAccessContext {
  planRepo?: { getPlan: (id: string) => Promise<{ id: string; conv_id: string } | null> };
}

/**
 * Asserts that the caller has access to the specified conversation.
 * - Scoped conversation (workspace_id IS NOT NULL):
 *   Requires caller to be the conversation owner AND an active member of an active workspace.
 *   Returns private HTTP 404 for any unauthorized or revoked caller (Hidden pattern).
 * - Legacy conversation (workspace_id IS NULL):
 *   Requires caller to be the conversation owner, preserving legacy denial status (default 404, or 403 where configured).
 */
export async function assertConversationAccess(
  poolOrClient: pg.Pool | pg.PoolClient,
  conversationId: string,
  userId: string,
  options?: ConversationAccessOptions
): Promise<ConversationRow> {
  if (!isUuid(conversationId) || !isUuid(userId)) {
    throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  const res = await poolOrClient.query<ConversationRow>(
    'SELECT * FROM conversations WHERE id = $1',
    [conversationId]
  );
  const conv = res.rows[0];
  if (!conv) {
    throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  // Scoped conversation
  if (conv.workspace_id) {
    // Hidden 404: unauthorized caller cannot know the conversation exists
    if (conv.user_id !== userId) {
      throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    // Must be active member of an active workspace
    const memberRes = await poolOrClient.query<{ active: boolean }>(
      `SELECT (m.status = 'active' AND w.status = 'active') AS active
       FROM ati_workspace_memberships m
       JOIN ati_workspaces w ON w.id = m.workspace_id
       WHERE m.workspace_id = $1 AND m.user_id = $2`,
      [conv.workspace_id, userId]
    );

    if (!memberRes.rows[0] || !memberRes.rows[0].active) {
      throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    return conv;
  }

  // Legacy conversation (workspace_id IS NULL)
  if (conv.user_id !== userId) {
    const status = options?.legacyNonOwnerStatus ?? 404;
    throw new ConversationAccessDeniedError(
      status,
      status === 403 ? 'Forbidden' : 'Conversation not found',
      status === 403 ? 'FORBIDDEN' : 'CONVERSATION_NOT_FOUND'
    );
  }

  return conv;
}

/**
 * Asserts conversation access with fail-closed fallback when PostgreSQL authority pool is unavailable.
 * - If pool is present: delegates to assertConversationAccess.
 * - If pool is absent: looks up conversation from trusted metadata provider (convRepo).
 *   - If row not found: fails closed (404).
 *   - If row has non-null workspace_id (scoped): fails closed (404) because membership/workspace authority cannot be verified without pool.
 *   - If row is proven legacy (workspace_id is null/undefined): enforces owner-only access (legacyNonOwnerStatus, default 404 or 403).
 */
export async function assertConversationAccessWithFallback(
  context: ConversationAccessContext,
  conversationId: string,
  userId: string,
  options?: ConversationAccessOptions
): Promise<ConversationRow> {
  if (context.pool) {
    return assertConversationAccess(context.pool, conversationId, userId, options);
  }

  if (!context.convRepo) {
    throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  const conv = await context.convRepo.getConversation(conversationId);
  if (!conv) {
    throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  // Scoped conversation: requires PostgreSQL authority pool to verify membership & workspace status.
  // When pool is unavailable, fail closed with 404 (hidden pattern).
  if (conv.workspace_id) {
    throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }

  // Legacy conversation (workspace_id is NULL)
  if (conv.user_id !== userId) {
    const status = options?.legacyNonOwnerStatus ?? 404;
    throw new ConversationAccessDeniedError(
      status,
      status === 403 ? 'Forbidden' : 'Conversation not found',
      status === 403 ? 'FORBIDDEN' : 'CONVERSATION_NOT_FOUND'
    );
  }

  return conv;
}

/**
 * Resolves plan -> conversation linkage and asserts conversation access with fail-closed fallback.
 * Operates durably with PostgreSQL pool or standalone repository metadata provider.
 */
export async function resolveAndAssertPlanAccess(
  context: PlanAccessContext,
  planId: string,
  userId: string,
  options?: ConversationAccessOptions
): Promise<{ planId: string; convId: string }> {
  let convId: string | undefined;

  if (context.pool) {
    if (!isUuid(planId)) {
      throw new ConversationAccessDeniedError(404, 'Plan not found', 'PLAN_NOT_FOUND');
    }
    const res = await context.pool.query<{ conv_id: string }>(
      'SELECT conv_id FROM plans WHERE id = $1',
      [planId]
    );
    const plan = res.rows[0];
    if (!plan) {
      throw new ConversationAccessDeniedError(404, 'Plan not found', 'PLAN_NOT_FOUND');
    }
    convId = plan.conv_id;
  } else if (context.planRepo) {
    const plan = await context.planRepo.getPlan(planId);
    if (!plan) {
      throw new ConversationAccessDeniedError(404, 'Plan not found', 'PLAN_NOT_FOUND');
    }
    convId = plan.conv_id;
  } else {
    throw new ConversationAccessDeniedError(404, 'Plan not found', 'PLAN_NOT_FOUND');
  }

  await assertConversationAccessWithFallback(
    context,
    convId,
    userId,
    options
  );

  return { planId, convId };
}
