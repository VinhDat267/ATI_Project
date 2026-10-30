import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { ProbeError } from './client.mjs';

const scopesFor = {
  identity: ['read:me', 'offline_access'],
  jira: ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access'],
};
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Diagnostic memory only. Production ownership/rotation persistence is JIRA-03/04. */
export function createProbeSession({ client, mode, clock = Date.now }) {
  if (!['fixture', 'live'].includes(mode) || client.mode !== mode) throw new ProbeError('INVALID_CONFIG');
  let owner, generation = 0, pending, accountId, grant, inflight;
  let siteCount = 0, adminSiteCount = 0;
  const emptyObservations = () => ({ identity: false, jiraAuthorization: false, tokenRotation: false, permissionsRead: false });
  let observations = emptyObservations();
  function bind(browserBinding) {
    if (typeof browserBinding !== 'string' || !browserBinding) throw new ProbeError('BROWSER_MISMATCH');
    if (owner === undefined) owner = browserBinding;
    if (!same(owner, browserBinding)) throw new ProbeError('BROWSER_MISMATCH');
  }
  function current(version) { if (version !== generation) throw new ProbeError('FLOW_SUPERSEDED'); }
  function validateTokens(tokens, flow, rotatingFrom) {
    const required = scopesFor[flow].filter(scope => scope !== 'offline_access');
    if (!required.every(scope => tokens.scopes.includes(scope))) throw new ProbeError('MISSING_SCOPE');
    if (!tokens.refreshToken) throw new ProbeError('REFRESH_REQUIRED');
    if (rotatingFrom && tokens.refreshToken === rotatingFrom) throw new ProbeError('ROTATION_NOT_OBSERVED');
  }

  return {
    start(flow, browserBinding) {
      bind(browserBinding);
      if (!Object.hasOwn(scopesFor, flow)) throw new ProbeError('INVALID_INPUT');
      const state = randomBytes(32).toString('base64url');
      const version = ++generation;
      grant = undefined; inflight = undefined; siteCount = 0; adminSiteCount = 0;
      observations = emptyObservations();
      pending = { hash: digest(state), expires: clock() + 600_000, version, flow };
      return { authorizationUrl: client.authorizationUrl({ state, scopes: [...scopesFor[flow]] }) };
    },
    async callback({ state, code, error, browserBinding }) {
      bind(browserBinding);
      if (typeof state !== 'string' || state.length > 512 || !pending || !same(digest(state), pending.hash) || pending.expires <= clock()) throw new ProbeError('INVALID_STATE');
      const attempt = pending; pending = undefined; // Consume before asynchronous exchange.
      if (error) throw new ProbeError('CONSENT_DENIED');
      if (typeof code !== 'string' || !code || code.length > 8192) throw new ProbeError('INVALID_INPUT');
      try {
        const tokens = await client.exchangeCode(code); current(attempt.version);
        validateTokens(tokens, attempt.flow);
        const profile = await client.profile(tokens.accessToken); current(attempt.version);
        if (accountId && profile.accountId !== accountId) throw new ProbeError('ACCOUNT_CHANGED');
        let sites = [], admins = 0;
        if (attempt.flow === 'jira') {
          sites = await client.resources(tokens.accessToken); current(attempt.version);
          for (const site of sites) {
            const permission = await client.permissions(tokens.accessToken, site.id); current(attempt.version);
            if (permission.administer) admins++;
          }
        }
        current(attempt.version);
        accountId = profile.accountId; grant = { ...tokens, flow: attempt.flow };
        siteCount = sites.length; adminSiteCount = admins;
        observations.identity = true;
        if (attempt.flow === 'jira') { observations.jiraAuthorization = true; observations.permissionsRead = sites.length > 0; }
      } catch (failure) {
        if (generation === attempt.version) grant = undefined;
        throw failure instanceof ProbeError ? failure : new ProbeError('PROVIDER_RESPONSE');
      }
    },
    async refresh(browserBinding) {
      bind(browserBinding);
      if (inflight) return inflight;
      if (!grant) throw new ProbeError('NOT_CONNECTED');
      const version = generation, previous = grant;
      const refresh = (async () => {
        try {
          const tokens = await client.refresh(previous.refreshToken); current(version);
          // OAuth refresh may omit scope; retaining the previously granted scope is allowed.
          if (!tokens.scopes.length) tokens.scopes = [...previous.scopes];
          validateTokens(tokens, previous.flow, previous.refreshToken);
          const profile = await client.profile(tokens.accessToken); current(version);
          if (profile.accountId !== accountId) throw new ProbeError('ACCOUNT_CHANGED');
          grant = { ...tokens, flow: previous.flow };
          observations.tokenRotation = true;
        } catch (failure) {
          if (generation === version) grant = undefined;
          throw failure instanceof ProbeError ? failure : new ProbeError('PROVIDER_RESPONSE');
        }
      })();
      inflight = refresh;
      try { await refresh; } finally { if (inflight === refresh) inflight = undefined; }
    },
    disconnect(browserBinding) {
      bind(browserBinding); generation++; pending = undefined; grant = undefined; accountId = undefined; inflight = undefined; siteCount = 0; adminSiteCount = 0;
      observations = emptyObservations();
    },
    report(browserBinding) {
      bind(browserBinding);
      return {
        schemaVersion: 1, provenance: mode === 'live' ? 'atlassian_live' : 'local_fixture',
        connected: Boolean(grant), scopes: (grant?.scopes ?? []).filter(scope => scopesFor.jira.includes(scope)), siteCount, adminSiteCount,
        observations: { ...observations },
        nativeGate: mode === 'fixture' ? 'NOT_RUN' : 'REQUIRES_REVIEW',
        noSiteMembership: 'REQUIRES_OPERATOR_ATTESTATION',
      };
    },
  };
}
