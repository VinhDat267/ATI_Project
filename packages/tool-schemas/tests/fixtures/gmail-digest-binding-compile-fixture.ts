/**
 * Consumer Compile Fixture for GMAIL-G2 A0 Source Binding Contracts.
 *
 * Imported by `tests/fixtures/consumer-compile-fixture.ts` so it is typechecked by
 * `tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json` without modifying
 * `tsconfig.contracts.json`.
 *
 * Asserts compile-time literal contracts directly against existing `TelegramDigestSource`
 * and `TelegramDigestConfig` exports so baseline RED produces excess-property diagnostics
 * (`TS2353`) rather than nonexistent-symbol failures.
 */

import type {
  TelegramDigestConfig,
  TelegramDigestSource,
} from '../../src/index.js';

// ============================================================================
// 1. Legacy non-Gmail & unbound decoding compatibility (valid on baseline + A0)
// ============================================================================

const legacyGithubSource: TelegramDigestSource = {
  service: 'github',
  tool: 'github.search_issues',
  args: { repo: 'acme/platform', query: 'open' },
  label: 'GitHub Issues đang mở (acme/platform)',
};

const legacyCalendarSource: TelegramDigestSource = {
  service: 'calendar',
  tool: 'calendar.list_events',
  label: 'Lịch nhóm hôm nay',
};

const legacyNonGmailConfig: TelegramDigestConfig = {
  credentialId: 'cred-tg-legacy-01',
  telegramUserId: '100200300',
  username: 'legacy_owner',
  chatId: '-1009988776655',
  chatTitle: 'Engineering Digest',
  sources: [legacyGithubSource, legacyCalendarSource],
  recurrence: { type: 'daily', time: '08:30' },
  timeZone: 'Asia/Ho_Chi_Minh',
};

// Optional at type level only so legacy Gmail rows can be decoded and failed closed in A1.
const _legacyUnboundGmailSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  args: { query: 'in:inbox is:unread' },
  label: 'Email chưa đọc',
};

// ============================================================================
// 2. Compile-positive versioned Gmail source binding literals
// ============================================================================

const validGmailBoundSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  args: { query: 'in:inbox is:unread' },
  label: 'Email chưa đọc',
  binding: {
    kind: 'gmail',
    credentialId: 'cred-gmail-gen-01',
    email: 'owner@example.com',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
  },
};

const _validVersion1DigestConfig: TelegramDigestConfig = {
  credentialId: 'cred-tg-01',
  telegramUserId: '100200300',
  username: 'owner_tg',
  chatId: '-1009988776655',
  chatTitle: 'Personal Mail Digest',
  sourceBindingVersion: 1,
  sources: [validGmailBoundSource, legacyGithubSource],
  recurrence: { type: 'weekly', time: '09:00', days: [1, 3, 5] },
  timeZone: 'Asia/Ho_Chi_Minh',
};

// ============================================================================
// 3. Compile-negative constraints (@ts-expect-error)
// ============================================================================

const _wrongKindSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  binding: {
    // @ts-expect-error - GmailDigestBinding.kind must be literal 'gmail'
    kind: 'mycalendar',
    credentialId: 'cred-gmail-gen-01',
    email: 'owner@example.com',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
  },
};

const _missingCredentialIdSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  // @ts-expect-error - GmailDigestBinding requires credentialId
  binding: {
    kind: 'gmail',
    email: 'owner@example.com',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
  },
};

const _missingEmailSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  // @ts-expect-error - GmailDigestBinding requires email
  binding: {
    kind: 'gmail',
    credentialId: 'cred-gmail-gen-01',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
  },
};

const _missingOauthClientIdSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  // @ts-expect-error - GmailDigestBinding requires oauthClientId
  binding: {
    kind: 'gmail',
    credentialId: 'cred-gmail-gen-01',
    email: 'owner@example.com',
  },
};

const _version2DigestConfig: TelegramDigestConfig = {
  ...legacyNonGmailConfig,
  // @ts-expect-error - TelegramDigestConfig.sourceBindingVersion only permits literal 1
  sourceBindingVersion: 2,
};

const _version0DigestConfig: TelegramDigestConfig = {
  ...legacyNonGmailConfig,
  // @ts-expect-error - TelegramDigestConfig.sourceBindingVersion only permits literal 1
  sourceBindingVersion: 0,
};

const _accessTokenInBindingSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  binding: {
    kind: 'gmail',
    credentialId: 'cred-gmail-gen-01',
    email: 'owner@example.com',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
    // @ts-expect-error - GmailDigestBinding must never include accessToken
    accessToken: 'synthetic-non-secret-access-token',
  },
};

const _refreshTokenInBindingSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  binding: {
    kind: 'gmail',
    credentialId: 'cred-gmail-gen-01',
    email: 'owner@example.com',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
    // @ts-expect-error - GmailDigestBinding must never include refreshToken
    refreshToken: 'synthetic-non-secret-refresh-token',
  },
};

const _clientSecretInBindingSource: TelegramDigestSource = {
  service: 'gmail',
  tool: 'gmail.search_threads',
  label: 'Email chưa đọc',
  binding: {
    kind: 'gmail',
    credentialId: 'cred-gmail-gen-01',
    email: 'owner@example.com',
    oauthClientId: '123456789012-synthetic.apps.googleusercontent.com',
    // @ts-expect-error - GmailDigestBinding must never include clientSecret
    clientSecret: 'synthetic-non-secret-client-secret',
  },
};

export const GMAIL_DIGEST_BINDING_COMPILE_FIXTURE_LOADED = true;
