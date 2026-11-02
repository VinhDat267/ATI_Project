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
  expectedWorkspaceId?: string | null;
  expectedWorkspaceMode?: 'legacy' | 'personal' | 'organization';
  ordinaryOrgAccessDeniedAs403?: boolean;
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
 *   - Requires caller to be the conversation owner.
 *   - Binds to expected workspace header/context (mismatches return 404 Hidden pattern).
 *   - Generic Layer: Requires caller to be an active member of an active organization workspace.
 *   - Jira Layer: If jira_context is true, ALSO requires caller to be an active Jira member of an active Jira policy.
 *   - Returns private HTTP 404 for any unauthorized or revoked caller (Hidden pattern).
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

  const actualWsId = conv.workspace_id ?? null;
  const isNullScope = actualWsId === null;

  // Header / context binding checks
  if (options?.expectedWorkspaceMode !== undefined) {
    const expectedMode = options.expectedWorkspaceMode;
    if (expectedMode === 'organization') {
      // Organization contexts never see NULL-scoped (personal/legacy) history
      if (isNullScope) {
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    } else if (expectedMode === 'personal') {
      // Personal context can only see NULL-scoped history
      if (!isNullScope) {
        if (options?.ordinaryOrgAccessDeniedAs403 && !conv.jira_context) {
          throw new ConversationAccessDeniedError(403, 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED');
        }
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    } else if (expectedMode === 'legacy') {
      // Legacy context (no header sent):
      if (!isNullScope && !conv.jira_context) {
        // Standard endpoints (GET /:id, POST /:id/messages) reject omitted header on ordinary org conversations with 404
        if (!options?.ordinaryOrgAccessDeniedAs403) {
          throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
        }
      }
    }
  }

  if (options?.expectedWorkspaceId !== undefined) {
    const expectedWsId = options.expectedWorkspaceId ?? null;
    if (expectedWsId !== null) {
      if (actualWsId !== expectedWsId) {
        if (options?.ordinaryOrgAccessDeniedAs403 && !conv.jira_context && actualWsId !== null) {
          throw new ConversationAccessDeniedError(403, 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED');
        }
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    } else if (options.expectedWorkspaceMode === 'organization') {
      if (isNullScope) {
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    }
  }

  // Scoped organization conversation
  if (conv.workspace_id) {
    // Hidden 404: unauthorized caller cannot know the conversation exists
    if (conv.user_id !== userId) {
      throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    // Layer 1: Generic organization workspace membership & active user
    const memberRes = await poolOrClient.query<{ active: boolean }>(
      `SELECT (wm.status = 'active' AND u.status = 'active') AS active
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [conv.workspace_id, userId]
    );

    if (!memberRes.rows[0] || !memberRes.rows[0].active) {
      if (options?.ordinaryOrgAccessDeniedAs403 && !conv.jira_context) {
        throw new ConversationAccessDeniedError(403, 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED');
      }
      throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    // Layer 2: Jira policy extension & membership (required ONLY when jira_context is true)
    if (conv.jira_context) {
      const jiraMemberRes = await poolOrClient.query<{ active: boolean }>(
        `SELECT (jm.status = 'active' AND jw.status = 'active') AS active
         FROM ati_workspace_memberships jm
         JOIN ati_workspaces jw ON jw.id = jm.workspace_id
         WHERE jm.workspace_id = $1 AND jm.user_id = $2`,
        [conv.workspace_id, userId]
      );

      if (!jiraMemberRes.rows[0] || !jiraMemberRes.rows[0].active) {
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
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

  const actualWsId = conv.workspace_id ?? null;
  const isNullScope = actualWsId === null;

  // Header / context binding checks
  if (options?.expectedWorkspaceMode !== undefined) {
    const expectedMode = options.expectedWorkspaceMode;
    if (expectedMode === 'organization') {
      if (isNullScope) {
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    } else if (expectedMode === 'personal') {
      if (!isNullScope) {
        if (options?.ordinaryOrgAccessDeniedAs403 && !conv.jira_context) {
          throw new ConversationAccessDeniedError(403, 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED');
        }
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    } else if (expectedMode === 'legacy') {
      if (!isNullScope) {
        if (!options?.ordinaryOrgAccessDeniedAs403) {
          throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
        }
      }
    }
  }

  if (options?.expectedWorkspaceId !== undefined) {
    const expectedWsId = options.expectedWorkspaceId ?? null;
    if (expectedWsId !== null) {
      if (actualWsId !== expectedWsId) {
        if (options?.ordinaryOrgAccessDeniedAs403 && !conv.jira_context && actualWsId !== null) {
          throw new ConversationAccessDeniedError(403, 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED');
        }
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    } else if (options.expectedWorkspaceMode === 'organization') {
      if (isNullScope) {
        throw new ConversationAccessDeniedError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
      }
    }
  }

  // Scoped conversation: requires PostgreSQL authority pool to verify membership & workspace status.
  // When pool is unavailable, fail closed with 404 (hidden pattern) or 403 where configured for ordinary org.
  if (conv.workspace_id) {
    if (options?.ordinaryOrgAccessDeniedAs403 && !conv.jira_context) {
      throw new ConversationAccessDeniedError(403, 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED');
    }
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
