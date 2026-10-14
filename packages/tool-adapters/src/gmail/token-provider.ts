/**
 * Supplies the Gmail access token of one connected member (GMAIL-common 4.4).
 * Refreshes when less than 60 s remain or when `forceRefresh` is set. Failures
 * are StepErrors: AUTH_ERROR when the grant is gone (the connection becomes
 * reconnect_required), NETWORK or SERVER_ERROR when refreshing failed.
 */
export interface GmailAccessTokenProvider {
  getAccessToken(options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string>;
}
