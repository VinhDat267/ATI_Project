import { describe, expect, it } from 'vitest';
import {
  CALENDAR_TOOLS,
  GITHUB_OAUTH_TOOLS,
  GITHUB_TOOLS,
  GMAIL_TOOLS,
  MYCALENDAR_SERVICE,
  MYCALENDAR_TOOLS,
  MYJIRA_SERVICE,
  MYJIRA_TOOLS,
  MYSHEETS_SERVICE,
  MYSHEETS_TOOLS,
  SERVICE_REGISTRY,
  SHEETS_TOOLS,
  SLACK_TOOLS,
  validateSlackSourceReplyPlan,
} from '@wap/tool-schemas';
import {
  AIPlanner,
  ReportArtifactStore,
  WorkingMemory,
  planSlackProposalWorkflow,
  routeIntent,
  validatePlan,
} from '../src/index.js';
import { scheduleRules } from '../src/prompts/schedule-rules.js';

describe('Backend Audit Hardening — Planner, Validator & Routing (Task 3)', () => {
  const fullCatalog = [...GITHUB_TOOLS, ...GITHUB_OAUTH_TOOLS, ...MYJIRA_TOOLS, ...GMAIL_TOOLS];

  describe('validatePlan array bracket indexing & non-string $ref support', () => {
    it('accepts bracketed array $ref targeting number/string schema properties while enforcing output properties', () => {
      const githubPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Fetch matching items and add review note',
        summary: 'Add review note on first item',
        warnings: [],
        steps: [
          {
            id: 'step_1',
            tool: 'github.list_issues',
            description: 'Fetch items',
            args: { repo: 'team/project', state: 'open' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'github.add_comment',
            description: 'Comment on first issue',
            args: {
              repo: 'team/project',
              issueNumber: { $ref: 'step_1.output[0].number' },
              body: 'Checked by backend audit',
            },
            dependsOn: ['step_1'],
          },
        ],
      });
      expect(validatePlan(githubPlan, fullCatalog)).toMatchObject({ valid: true });

      const jiraPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Search Jira issues then add comment on the first issue',
        summary: 'Comment on first Jira issue',
        warnings: [],
        steps: [
          {
            id: 'step_1',
            tool: 'myjira.search_issues',
            description: 'Search Jira issues',
            args: { siteId: 'site-1', projectKey: 'ATI' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'myjira.add_comment',
            description: 'Comment on first issue',
            args: {
              siteId: 'site-1',
              issueKey: { $ref: 'step_1.output.issues[0].key' },
              body: 'Checking status',
            },
            dependsOn: ['step_1'],
          },
        ],
      });
      expect(validatePlan(jiraPlan, fullCatalog)).toMatchObject({ valid: true });

      const badPropPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Invalid property on array item',
        summary: 'Bad property',
        warnings: [],
        steps: [
          {
            id: 'step_1',
            tool: 'github.list_issues',
            description: 'List issues',
            args: { repo: 'team/project', state: 'open' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'github.add_comment',
            description: 'Comment',
            args: {
              repo: 'team/project',
              issueNumber: 7,
              body: { $ref: 'step_1.output[0].nonExistentField' },
            },
            dependsOn: ['step_1'],
          },
        ],
      });
      expect(validatePlan(badPropPlan, fullCatalog)).toMatchObject({
        valid: false,
        layer: 'semantic',
      });

      const badRecipientPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Attempt $ref on x-recipient to field',
        summary: 'Send email',
        warnings: [],
        steps: [
          {
            id: 'step_1',
            tool: 'gmail.search_threads',
            description: 'Search threads',
            args: { query: 'from:alice@example.com' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'gmail.send_message',
            description: 'Send email',
            args: {
              to: { $ref: 'step_1.output.threads[0].participants' },
              subject: 'Update',
              body: 'Hello',
            },
            dependsOn: ['step_1'],
          },
        ],
      });
      expect(validatePlan(badRecipientPlan, fullCatalog)).toMatchObject({ valid: false });
    });
  });

  describe('routeIntent explicit organization Calendar/Sheets keywords', () => {
    const tools = [...CALENDAR_TOOLS, ...MYCALENDAR_TOOLS, ...SHEETS_TOOLS, ...MYSHEETS_TOOLS];
    const registry = [...SERVICE_REGISTRY, MYCALENDAR_SERVICE, MYSHEETS_SERVICE];

    it('routes explicit org calendar and org sheets queries to shared calendar/sheets while preserving default mysheets routing', () => {
      const orgCal = routeIntent('Xem lịch tổ chức hôm nay', tools, registry);
      expect(orgCal.services).toContain('calendar');

      const orgSheets = routeIntent('Đọc bảng tính tổ chức doanh thu Q4', tools, registry);
      expect(orgSheets.services).toContain('sheets');

      const genericSheets = routeIntent('Cập nhật trạng thái trong bảng tính CRM Khách hàng', tools, registry);
      expect(genericSheets.services).toContain('mysheets');
      expect(genericSheets.services).not.toContain('sheets');
    });
  });

  describe('AIPlanner search and grounded report partial/truncation coverage', () => {
    it('flags truncated search outcomes on hasMore / wasSliced / coverage incomplete responses', async () => {
      let seenSecondTurnPrompt = '';
      const searchTools = [...GITHUB_TOOLS, ...GITHUB_OAUTH_TOOLS];
      let turn = 0;

      const planner = new AIPlanner({
        toolCatalog: searchTools,
        searchMode: 'llm',
        prefetchDirectory: false,
        gatherSearch: async () => ({
          issues: [{ id: '1', number: 7, title: 'Bug 7', url: 'https://github.com/acme/web/issues/7', repo: 'acme/web' }],
          hasMore: true,
        }),
        provider: {
          name: 'mock',
          model: 'mock',
          generatePlan: async ({ conversationHistory }) => {
            turn++;
            if (turn === 1) {
              return JSON.stringify({
                kind: 'search',
                calls: [{ tool: 'github.search_issues', args: { repo: 'acme/web', query: 'Bug' } }],
              });
            }
            seenSecondTurnPrompt = conversationHistory.map((m) => m.content).join('\n');
            return JSON.stringify({
              kind: 'clarification',
              question: 'Kết quả chỉ là một phần, bạn muốn lọc tiếp không?',
              context: 'Partial results',
            });
          },
        },
      });

      const memory = new WorkingMemory();
      memory.setEntity('repository', [{ id: 'acme/web', fullName: 'acme/web', name: 'web' }]);
      await planner.processMessage({ userMessage: 'Tìm các issue có chữ Bug trên acme/web', memory });
      expect(seenSecondTurnPrompt).toContain('reported more items beyond this page');
    });

    it('preserves coverage=partial on reportEvidence when myjira.search_issues returns coverage.completeness=PARTIAL', async () => {
      const store = new ReportArtifactStore();
      const tools = [...MYJIRA_TOOLS, ...SLACK_TOOLS];
      const serviceRegistry = [
        ...SERVICE_REGISTRY.filter((s) => s.id !== 'jira'),
        MYJIRA_SERVICE,
      ];
      const planner = new AIPlanner({
        toolCatalog: tools,
        serviceRegistry,
        searchMode: 'llm',
        prefetchDirectory: false,
        reportEvidenceStore: store,
        gatherSearch: async () => ({
          issues: [
            {
              siteId: 'site-1',
              id: '1001',
              key: 'ATI-1',
              url: 'https://ati.atlassian.net/browse/ATI-1',
              title: 'Sample Jira bug',
              status: 'In Progress',
            },
          ],
          coverage: {
            completeness: 'PARTIAL',
            pagesFetched: 1,
            itemsReturned: 1,
            budgetMs: 5000,
            elapsedMs: 120,
            truncationReason: 'ITEM_CAP_REACHED',
          },
        }),
        provider: {
          name: 'mock',
          model: 'mock',
          generatePlan: async () =>
            JSON.stringify({
              kind: 'plan',
              thinking: 'Read Jira issues and send partial summary to Slack',
              summary: 'Send Jira report',
              warnings: [],
              steps: [
                {
                  id: 's_read',
                  tool: 'myjira.search_issues',
                  description: 'Search Jira issues',
                  args: { siteId: 'site-1', projectKey: 'ATI' },
                  dependsOn: [],
                },
                {
                  id: 's_post',
                  tool: 'slack.send_message',
                  description: 'Send to Slack',
                  args: { channel: 'C_DEV', text: 'Placeholder' },
                  dependsOn: ['s_read'],
                },
              ],
            }),
        },
      });

      const memory = new WorkingMemory();
      memory.setEntity('workflow_resource_defaults', {
        myjira: { siteId: 'site-1', projectKey: 'ATI' },
        slack: { channelId: 'C_DEV', channelName: 'dev' },
      });

      const out = await planner.processMessage({
        userMessage: 'Tổng hợp tiến độ Jira project ATI gửi vào kênh dev mặc định',
        memory,
        actor: { userId: 'u1', workspaceId: 'ws1' },
      });
      expect(out.kind).toBe('plan');
      if (out.kind === 'plan') {
        expect(out.reportEvidence?.coverage).toBe('partial');
      }
    });
  });

  describe('scheduleRules & Slack proposal MyJira/Notion support', () => {
    it('includes Gmail as a valid send destination in scheduleRules rule 6', () => {
      const rules = scheduleRules();
      expect(rules).toMatch(/6\.[^\n]*(?:Gmail|email)/i);
    });

    it('planSlackProposalWorkflow uses myjira tools + siteId when myjira context is supplied and accepts notion connections in reply plan', () => {
      const binding = {
        atiUserId: '00000000-0000-4000-8000-000000000001',
        connectionId: '00000000-0000-4000-8000-000000000002',
        workspaceId: 'T_ONE',
        slackUserId: 'U_ONE',
        identityVersion: 1,
      };
      const policyReference = {
        binding,
        purpose: 'planning' as const,
        requestedRetentionDays: 1,
        providerProfileId: 'provider',
        configFingerprint: 'a'.repeat(64),
        policyVersion: 'v1.0.0',
        consentRevision: '1',
        providerRevision: '1',
      };

      const planned = planSlackProposalWorkflow({
        ownerId: binding.atiUserId,
        binding,
        policyReference,
        source: { channelId: 'C_BUGS', messageTs: '1730000000.000200' },
        proposal: {
          title: 'Lỗi OAuth Jira',
          rationale: 'Bug từ Slack',
          intents: [{ action: 'issue', service: 'jira', summary: 'Fix OAuth redirect' }],
          sourceTexts: ['<@U_ONE> tạo ticket lỗi OAuth Jira nhé'],
        },
        targets: {
          bug: { siteId: 'site-1', projectKey: 'ATI', allowedProjectKeys: ['ATI'] } as any,
          replyInThread: true,
        },
      });
      expect(planned.kind).toBe('plan');
      if (planned.kind === 'plan') {
        expect(planned.plan.steps.map((s) => s.tool)).toEqual([
          'myjira.search_issues',
          'myjira.create_issue',
          'myslack.chat_postMessage',
        ]);
        expect(planned.plan.steps[0]?.args).toMatchObject({ siteId: 'site-1', projectKey: 'ATI' });
        expect(planned.plan.steps[1]?.args).toMatchObject({ siteId: 'site-1', projectKey: 'ATI' });
        expect(planned.plan.steps[1]?.reuseExistingIssueFrom).toBe('step_1');
      }

      const notionConnectedPlan = {
        kind: 'plan',
        thinking: 'Reply with Notion reference',
        summary: 'Reply in thread',
        warnings: [],
        steps: [
          {
            id: 'step_1',
            tool: 'notion.create_page',
            description: 'Create Notion page',
            args: { databaseId: 'db1', title: 'Note' },
            dependsOn: [],
          },
          {
            id: 'step_2',
            tool: 'myslack.chat_postMessage',
            description: 'Reply in Slack',
            args: { channel: 'C_BUGS', thread_ts: '1730000000.000200', text: { $template: 'Created: ${step_1.output.url}' } },
            dependsOn: ['step_1'],
          },
        ],
        connections: {
          notion: {
            credentialId: 'n1',
            workspaceId: 'nw1',
            workspaceName: 'Docs',
            botId: 'nb1',
            identityVersion: 1,
            databaseIds: ['db1'],
          },
          myslack: {
            bindings: { [binding.connectionId]: binding },
            steps: {
              step_2: {
                connectionId: binding.connectionId,
                tool: 'myslack.chat_postMessage',
                dependencies: [{ refStepId: 'step_1', path: 'output.url', service: 'notion', kind: 'other' }],
                policyReference,
              },
            },
          },
        },
      };
      expect(() => validateSlackSourceReplyPlan(notionConnectedPlan, binding.atiUserId)).not.toThrow();
    });
  });
});
