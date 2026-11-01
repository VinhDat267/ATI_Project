import {
  validateSlackAssistantConfig,
  validateSlackAssistantSettingsView,
  validateSlackAssistantVersion,
  validateSlackProposalPrepareInput,
  validateSlackProposalRevisionInput,
  type SlackAssistantConfig,
} from '@wap/tool-schemas';
import { apiClient } from './api-client';

export interface SlackProposalViewDto {
  id: string;
  connectionId: string;
  conversationId: string;
  channelId: string;
  threadTs: string;
  triggerMessageTs: string;
  status: string;
  revision: string;
  configVersion: string;
  reviewExpiresAt: string;
  activePlanId: string | null;
  body: {
    decision: {
      kind: 'proposal';
      title: string;
      rationale: string;
      sourceIndices: number[];
      relevance: { kind: string; sourceIndex: number; evidence: string };
      intents: Array<{ action: string; service: string; summary: string }>;
    };
    context: Array<{ ts: string; user: string; text: string; thread_ts?: string }>;
  } | null;
}

export interface SlackDigestViewDto {
  id: string;
  connectionId: string;
  localDate: string;
  status: string;
  revision: string;
  configVersion: string;
  reviewExpiresAt: string;
  body: {
    localDate: string;
    timezone: string;
    generatedAt: string;
    summary: {
      totalProposals: number;
      pendingCount: number;
      needsInfoCount: number;
      awaitingApprovalCount: number;
      approvedCount: number;
      rejectedCount: number;
    };
    items: Array<{
      proposalId: string;
      conversationId: string;
      channelId: string;
      threadTs: string;
      title: string;
      rationale: string;
      status: string;
      actions: Array<{ action: string; service: string; summary: string }>;
    }>;
  } | null;
}

const path = (id: string) => '/api/connections/myslack/' + encodeURIComponent(id) + '/assistant';

export const slackAssistantApi = {
  get: async (id: string, signal?: AbortSignal) =>
    validateSlackAssistantSettingsView(await apiClient.request<unknown>(path(id), { signal, cache: 'no-store' })),
  update: async (id: string, expectedVersion: string, config: SlackAssistantConfig) => {
    validateSlackAssistantVersion(expectedVersion);
    const valid = validateSlackAssistantConfig(config);
    return validateSlackAssistantSettingsView(
      await apiClient.request<unknown>(path(id), {
        method: 'PUT',
        body: JSON.stringify({ expectedVersion, config: valid }),
        signal: AbortSignal.timeout(15000),
      }),
    );
  },
  follow: (id: string, channelId: string, threadTs: string, follow: boolean) =>
    apiClient.request<{ success: true }>(path(id) + '/followed-threads', {
      method: 'PUT',
      body: JSON.stringify({ channelId, threadTs, follow }),
      signal: AbortSignal.timeout(15000),
    }),
  listProposals: (connectionId: string, signal?: AbortSignal) =>
    apiClient.request<{ proposals: SlackProposalViewDto[] }>(
      '/api/slack/proposals?connectionId=' + encodeURIComponent(connectionId),
      { signal, cache: 'no-store' },
    ),
  refineProposal: (id: string, expectedRevision: string | number) => {
    const valid = validateSlackProposalRevisionInput({ expectedRevision });
    return apiClient.request<{ conversationId: string; proposal: SlackProposalViewDto }>(
      '/api/slack/proposals/' + encodeURIComponent(id) + '/refine',
      {
        method: 'POST',
        body: JSON.stringify(valid),
        signal: AbortSignal.timeout(15000),
      },
    );
  },
  prepareProposal: (
    id: string,
    input: { expectedRevision: string | number; instruction?: string; replyInThread?: boolean },
  ) => {
    const valid = validateSlackProposalPrepareInput(input);
    return apiClient.request<{
      status: 'awaiting_approval' | 'needs_info';
      proposal: SlackProposalViewDto;
      plan?: {
        id: string;
        planHash: string;
        summary: string;
        steps: Array<{ id: string; action: string; description: string }>;
      };
      question?: string;
    }>('/api/slack/proposals/' + encodeURIComponent(id) + '/prepare', {
      method: 'POST',
      body: JSON.stringify(valid),
      signal: AbortSignal.timeout(15000),
    });
  },
  rejectProposal: (id: string, expectedRevision: string | number) => {
    const valid = validateSlackProposalRevisionInput({ expectedRevision });
    return apiClient.request<{ proposal: SlackProposalViewDto }>(
      '/api/slack/proposals/' + encodeURIComponent(id) + '/reject',
      {
        method: 'POST',
        body: JSON.stringify(valid),
        signal: AbortSignal.timeout(15000),
      },
    );
  },
  listDigests: (connectionId: string, signal?: AbortSignal) =>
    apiClient.request<{ digests: SlackDigestViewDto[] }>(
      '/api/slack/digests?connectionId=' + encodeURIComponent(connectionId),
      { signal, cache: 'no-store' },
    ),
  refreshDigest: (id: string) =>
    apiClient.request<{ digest: SlackDigestViewDto }>(
      '/api/slack/digests/' + encodeURIComponent(id) + '/refresh-status',
      {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      },
    ),
};
