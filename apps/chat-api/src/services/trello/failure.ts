import { StepError } from '@wap/tool-adapters';
import { TrelloOAuthError } from './oauth-client.js';

/**
 * Only a definite loss of the grant counts as "reconnect": the token manager
 * already marked the credential (AUTH_ERROR), Atlassian said invalid_grant, or
 * Trello answered 401/403 to the access token. Network errors, timeouts, 5xx and
 * 429 are transient and must never send the user to reconnect or pause a schedule.
 */
export function isTrelloAuthFailure(error: unknown): boolean {
  if (error instanceof StepError) return error.category === 'AUTH_ERROR';
  if (error instanceof TrelloOAuthError) {
    return error.kind === 'invalid_grant' || error.status === 401 || error.status === 403;
  }
  return false;
}

/** Normalize Trello preflight errors before any tool request is dispatched. */
export function toTrelloStepError(error: unknown): StepError {
  if (error instanceof StepError) {
    if (error.details?.requestSent === false) return error;
    return new StepError({
      category: error.category,
      statusCode: error.statusCode,
      retryable: error.retryable,
      message: error.message,
      details: { ...error.details, requestSent: false },
      cause: error.cause,
    });
  }

  const statusCode = error instanceof TrelloOAuthError ? error.status : undefined;
  const details = { requestSent: false };
  if (isTrelloAuthFailure(error)) {
    return new StepError({
      category: 'AUTH_ERROR',
      statusCode,
      details,
      message: 'Trello cần được kết nối lại.',
    });
  }
  const network = !(error instanceof TrelloOAuthError) || error.kind === 'network';
  return new StepError({
    category: statusCode === 429 ? 'RATE_LIMIT' : network ? 'NETWORK' : 'SERVER_ERROR',
    statusCode,
    details,
    message: 'Trello tạm thời không phản hồi. Hãy thử lại sau.',
  });
}

/** A run signal (if any) combined with a hard timeout. */
export function trelloSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
