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

/** The StepError the executor sees for a failed Trello membership/token lookup. */
export function toTrelloStepError(error: unknown): StepError {
  if (error instanceof StepError) return error;
  if (isTrelloAuthFailure(error)) {
    return new StepError({
      category: 'AUTH_ERROR',
      statusCode: error instanceof TrelloOAuthError ? error.status : undefined,
      retryable: false,
      message: 'Trello cần được kết nối lại.',
    });
  }
  const network = !(error instanceof TrelloOAuthError) || error.kind === 'network';
  return new StepError({
    category: network ? 'NETWORK' : 'SERVER_ERROR',
    statusCode: error instanceof TrelloOAuthError ? error.status : undefined,
    retryable: false,
    message: 'Trello tạm thời không phản hồi. Hãy thử lại sau.',
  });
}

/** A run signal (if any) combined with a hard timeout. */
export function trelloSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
