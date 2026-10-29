import type {
  SlackBinding,
  SlackPolicyReference,
  SlackPolicyPurpose,
} from '@wap/tool-schemas';
import type { BaseAdapterConfig } from '../base-adapter.js';

export type SlackReadPurpose = Exclude<SlackPolicyPurpose, 'storage'>;

export type SlackPolicyHookDecision =
  | { allowed: true; policyReference: SlackPolicyReference }
  | { allowed: false; reason: string };

export interface SlackAuthorizeReadInput {
  binding: SlackBinding;
  purpose: SlackReadPurpose;
  requestedRetentionDays: 0;
  expectedPolicyReference?: SlackPolicyReference;
}

export interface SlackReadPolicyHook {
  authorizeRead(input: SlackAuthorizeReadInput): Promise<SlackPolicyHookDecision>;
}

export interface SlackTokenProviderHook {
  getAccessToken(binding: SlackBinding): Promise<string>;
}

export interface PersonalSlackReadAdapterConfig extends BaseAdapterConfig {
  tokens: SlackTokenProviderHook;
  policy: SlackReadPolicyHook;
  apiBaseUrl?: string; // native https://slack.com/api or explicit loopback http://127.0.0.1:<port>
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number; // default 10_000 ms
}

export interface SlackResourceIdentity {
  type: 'conversation' | 'message' | 'members' | 'user' | 'users' | 'permalink';
  channelId?: string;
  messageTs?: string;
  userId?: string;
}

export interface SlackObservationProvenance {
  binding: SlackBinding;
  resourceIdentity: SlackResourceIdentity;
  observedAt: string; // ISO 8601 UTC timestamp
  acquisitionPolicyReference: SlackPolicyReference; // Canonical 8-field ref from authorizeRead (purpose + 0 TTL)
  nativeRevision?: string; // Only present when Slack returns it (e.g. edited.ts || ts)
  observationalDigest: string; // SHA-256 hex string of canonical observation JSON
}

export interface SlackConversationSummary {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  created?: number;
  is_archived?: boolean;
  is_general?: boolean;
  unlinked?: number;
  creator?: string;
  name_normalized?: string;
  is_shared?: boolean;
  is_org_shared?: boolean;
  context_team_id?: string;
  updated?: number;
  num_members?: number;
  provenance: SlackObservationProvenance;
}

export interface SlackConversationDetail {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  created?: number;
  is_archived?: boolean;
  is_general?: boolean;
  creator?: string;
  name_normalized?: string;
  is_shared?: boolean;
  is_org_shared?: boolean;
  context_team_id?: string;
  updated?: number;
  num_members?: number;
  topic?: {
    value?: string;
    creator?: string;
    last_set?: number;
  };
  purpose?: {
    value?: string;
    creator?: string;
    last_set?: number;
  };
  provenance: SlackObservationProvenance;
}

export interface SlackMessageObservation {
  type: 'message';
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reply_users_count?: number;
  latest_reply?: string;
  edited?: {
    user?: string;
    ts: string;
  };
  provenance: SlackObservationProvenance;
}

export interface SlackUserSummary {
  id: string;
  team_id?: string;
  name?: string;
  deleted?: boolean;
  real_name?: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
  is_bot?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  updated?: number;
  provenance: SlackObservationProvenance;
}

export interface SlackUserDetail extends SlackUserSummary {}

export interface SlackPermalinkObservation {
  ok: true;
  channel: string;
  permalink: string;
  provenance: SlackObservationProvenance;
}

export interface SlackConversationsListResult {
  ok: true;
  channels: SlackConversationSummary[];
  nextCursor?: string;
  hasMore: boolean;
  provenance: SlackObservationProvenance;
}

export interface SlackConversationsInfoResult {
  ok: true;
  channel: SlackConversationDetail;
  provenance: SlackObservationProvenance;
}

export interface SlackConversationsHistoryResult {
  ok: true;
  messages: SlackMessageObservation[];
  nextCursor?: string;
  hasMore: boolean;
  provenance: SlackObservationProvenance;
}

export interface SlackConversationsRepliesResult {
  ok: true;
  messages: SlackMessageObservation[];
  nextCursor?: string;
  hasMore: boolean;
  provenance: SlackObservationProvenance;
}

export interface SlackConversationsMembersResult {
  ok: true;
  members: string[];
  nextCursor?: string;
  hasMore: boolean;
  provenance: SlackObservationProvenance;
}

export interface SlackUsersListResult {
  ok: true;
  members: SlackUserSummary[];
  nextCursor?: string;
  hasMore: boolean;
  provenance: SlackObservationProvenance;
}

export interface SlackUsersInfoResult {
  ok: true;
  user: SlackUserDetail;
  provenance: SlackObservationProvenance;
}
