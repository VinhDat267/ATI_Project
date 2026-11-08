import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { SERVICE_REGISTRY } from '@wap/tool-schemas';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directories = ['packages/planner/src', 'packages/executor/src', 'apps/chat-api/src/routes', 'apps/chat-api/src/services', 'apps/chat-web/src'];
const exceptions = [
  { file: 'apps/chat-api/src/services/slack/slack-private-read-wrapper.ts', pattern: /^slack\.com$/, reason: 'SLACK-03B4A provider boundary pins the native Slack credential destination; no generic routing branch.' },
  { file: 'apps/chat-api/src/services/slack/slack-proposal-service.ts', pattern: /^(?:calendar|github)$/, reason: 'SLACK-06 proposal service maps personal cross-service targets into proposal workflow plan input.' },
  { file: 'apps/chat-web/src/components/slack/SlackAutomationSettings.tsx', pattern: /^(?:trello|jira|github)$/, reason: 'SLACK-06 automation settings UI configures cross-service proposal destination targets.' },
  { file: 'apps/chat-web/src/components/slack/SlackProposalCard.tsx', pattern: /^(?:trello|jira|github)$/, reason: 'SLACK-06 proposal inbox card lets the owner review or override cross-service destination targets.' },
  { file: 'packages/planner/src/validator.ts', pattern: /^(?:trello\.(?:create_card|add_member)|sheets\.create_sheet)$/, reason: 'Trello board membership and Sheets tab creation business rules; explicit W3-00 exception.' },
  { file: 'packages/planner/src/planner.ts', pattern: /^(?:github\.(?:list_pull_requests|list_issues)|jira\.search_issues|sheets\.read_range|calendar\.list_events)$/, reason: 'FLOW-01 report binding and XSVC-01 read-answer grounding require these verified read tools, not a directory prefetch.' },
  { file: 'packages/planner/src/prompts/system-prompt.ts', pattern: /^(?:trello\.(?:create_card|add_member)|slack\.send_message|telegram\.send_message|notion\.create_page)$/, reason: 'Catalog-gated example; keep prompt and golden comparability.' },
  { file: 'packages/planner/src/recipients.ts', pattern: /^(?:sheets|notion|trello|jira)$/, reason: 'Service recipient label extraction rules.' },
  { file: 'apps/chat-web/src/components/MissionControlLaunchpad.tsx', pattern: /^(trello\.(create_card|add_member|add_checklist|search_boards|search_cards)|slack\.(send_message|search_channels)|github\.search_issues)$/, reason: 'Existing sample workflows, registered-tool availability checked by FE-01; frontend naming follows W3-00b.' },
  { file: 'apps/chat-web/src/components/LandingPage.tsx', pattern: /^(trello|slack|github)$/, reason: 'Introduction display strings, permitted by task.' },
  { file: 'apps/chat-web/src/components/LoginPage.tsx', pattern: /^(trello|slack|github)$/, reason: 'Login display strings, permitted by task.' },
  { file: 'apps/chat-web/src/components/Cockpit.tsx', pattern: /^sheets\.create_sheet$/, reason: 'Cockpit destination label formatting for Sheets tab creation.' },
  { file: 'apps/chat-web/src/pages/Guide/data.tsx', pattern: /^(?:trello|slack|github|sheets|calendar|notion|telegram|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'FE-10 presentation content; every declared tool is checked against the live catalog.' },
  { file: 'apps/chat-web/src/pages/Guide/gmail-data.tsx', pattern: /^(?:sheets)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Guide presentation content for Gmail and Sheets workflows.' },
  { file: 'apps/chat-web/src/pages/Guide/mysheets-data.tsx', pattern: /^(?:trello|slack|github|sheets|calendar|notion|telegram|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'OAUTH-03 presentation content; sample prompts for personal sheets workflows.' },
  { file: 'apps/chat-web/src/pages/Guide/GuidePage.tsx', pattern: /^(?:telegram|notion|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Guide 1-click OAuth showcase cards.' },
  { file: 'apps/chat-api/src/routes/connections/trello.ts', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/connections/mysheets.ts', pattern: /^sheets(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Google Sheets OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/connections/github.ts', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/connections/telegram.ts', pattern: /^telegram(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Telegram 1-click pairing names that service.' },
  { file: 'apps/chat-api/src/routes/connections/notion.ts', pattern: /^notion(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Notion OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/services-routes.ts', pattern: /^(?:trello|github|telegram|notion|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth services are managed outside shared service config.' },
  { file: 'apps/chat-api/src/services/adapter-factory.ts', pattern: /^(?:trello|github|telegram|notion|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth adapter construction names those services.' },
  { file: 'apps/chat-api/src/services/chat-service.ts', pattern: /^(?:trello|sheets|calendar|github|telegram|notion|jira|slack)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth and digest candidate evaluation names those services.' },
  { file: 'apps/chat-web/src/services/job-readiness.ts', pattern: /^(?:trello|slack|github|sheets|calendar|jira|notion|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'FLOW-04 Core production jobs readiness definition names those services.' },
  { file: 'apps/chat-api/src/services/schedules/sheets-digest-candidate.ts', pattern: /^(?:sheets|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Sheets digest candidate checks sheets read source and slack/telegram destination.' },
  { file: 'apps/chat-api/src/services/schedules/sheets-digest-runner.ts', pattern: /^(?:sheets|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Sheets digest runner reads sheets and delivers to slack/telegram.' },
  { file: 'apps/chat-api/src/services/schedules/calendar-digest-candidate.ts', pattern: /^(?:calendar|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Calendar digest candidate checks calendar read source and slack/telegram destination.' },
  { file: 'apps/chat-api/src/services/schedules/calendar-digest-runner.ts', pattern: /^(?:calendar|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Calendar digest runner reads calendar and delivers to slack/telegram.' },
  { file: 'apps/chat-api/src/services/schedules/github-digest-candidate.ts', pattern: /^(?:github|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled GitHub-to-Slack digest candidate validation.' },
  { file: 'apps/chat-api/src/services/schedules/github-digest-runner.ts', pattern: /^(?:github|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled GitHub-to-Slack digest execution.' },
  { file: 'apps/chat-api/src/services/schedules/trello-digest-candidate.ts', pattern: /^(?:trello|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled Trello digest candidate validation.' },
  { file: 'apps/chat-api/src/services/schedules/trello-digest-runner.ts', pattern: /^(?:trello|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled Trello digest execution.' },
  { file: 'apps/chat-api/src/services/schedules/notion-digest-candidate.ts', pattern: /^(?:notion|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled Notion digest candidate validation.' },
  { file: 'apps/chat-api/src/services/schedules/notion-digest-runner.ts', pattern: /^(?:notion|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled Notion digest execution.' },
  { file: 'apps/chat-api/src/services/schedules/jira-digest-candidate.ts', pattern: /^(?:jira|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled read-only Jira digest candidate validation.' },
  { file: 'apps/chat-api/src/services/schedules/jira-digest-runner.ts', pattern: /^(?:jira|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled read-only Jira digest execution.' },
  { file: 'apps/chat-api/src/services/schedules/telegram-digest-candidate.ts', pattern: /^(?:trello|slack|github|sheets|calendar|notion|telegram|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Telegram digest candidate checks read-only sources and telegram destination.' },
  { file: 'apps/chat-api/src/services/schedules/telegram-digest-runner.ts', pattern: /^(?:telegram|notion)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Telegram digest runner delivers reports to telegram.' },
  { file: 'apps/chat-api/src/services/schedules/schedule-service.ts', pattern: /^(?:sheets|calendar|github|telegram|trello|notion|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Digest schedule confirmation checks service kind.' },
  { file: 'apps/chat-api/src/services/registered-services.ts', pattern: /^(?:trello|github|telegram|notion|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth registration names those services.' },
  { file: 'apps/chat-api/src/services/jira/jira-oauth-client.ts', pattern: /^jira$/, reason: 'Jira-specific OAuth client filters accessible Jira resources returned by Atlassian.' },
  { file: 'apps/chat-api/src/services/jira/jira-lease-manager.ts', pattern: /^jira$/, reason: 'Jira-specific authorization lease checks grant-site product type in SQL.' },
  { file: 'apps/chat-api/src/services/jira/jira-policy-service.ts', pattern: /^jira$/, reason: 'Jira-specific source revalidation checks grant-site product type in SQL.' },
  { file: 'apps/chat-api/src/services/jira/jira-plan-binding.ts', pattern: /^jira$/, reason: 'Jira-specific plan binding checks grant-site product type in SQL.' },
  { file: 'apps/chat-api/src/services/jira/jira-approval-guard.ts', pattern: /^jira$/, reason: 'Jira-specific approval binding checks grant-site product type in SQL.' },
  { file: 'apps/chat-api/src/services/jira/jira-dispatch-guard.ts', pattern: /^jira$/, reason: 'Jira-specific dispatch guard checks grant-site product type in SQL.' },
  { file: 'apps/chat-api/src/services/jira/jira-history-sanitizer.ts', pattern: /^jira$/, reason: 'Jira-specific history sanitizer checks message service type.' },
  { file: 'apps/chat-api/src/services/jira-legacy-migration.ts', pattern: /^jira$/, reason: 'JIRA-11 legacy Jira schedule migration scans and pauses legacy jira.* schedules.' },
  { file: 'apps/chat-api/src/services/trello/connection-reference.ts', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-api/src/services/trello/token-manager.ts', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-api/src/services/github/connection-reference.ts', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/services/github/token-manager.ts', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/services/telegram/connection-reference.ts', pattern: /^telegram(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Telegram connection lookup names that service.' },
  { file: 'apps/chat-api/src/services/notion/connection-reference.ts', pattern: /^notion(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Notion OAuth names that service.' },
  { file: 'apps/chat-api/src/services/notion/token-manager.ts', pattern: /^notion(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Notion OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Cockpit/PlanMoment.tsx', pattern: /^(?:calendar|notion|trello)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Cockpit plan step preview pills for personal OAuth services.' },
  { file: 'apps/chat-web/src/pages/Cockpit/PreviewContents.tsx', pattern: /^(?:trello|notion|sheets|calendar)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Cockpit step preview cards for domain tools.' },
  { file: 'apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx', pattern: /^(?:trello|github|telegram|notion|sheets|jira|calendar)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth receipt displays account and execution metrics.' },
  { file: 'apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx', pattern: /^(?:sheets|notion|trello)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Cockpit recovery helper links for write steps.' },
  { file: 'apps/chat-web/src/pages/Cockpit/RequestMoments.tsx', pattern: /^(?:calendar|sheets|jira|github|slack|trello)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Cockpit request status chips and FLOW-04 default resource selector.' },
  { file: 'apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx', pattern: /^(?:sheets|calendar|github|slack|telegram|trello|notion|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Digest schedule confirmation displays destination service.' },
  { file: 'apps/chat-web/src/pages/Responses/ResponseMoment.tsx', pattern: /^(?:trello|github|telegram|notion)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth refusal displays connect button.' },
  { file: 'apps/chat-web/src/pages/Settings/TrelloConnection.tsx', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/GitHubConnection.tsx', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/TelegramConnection.tsx', pattern: /^telegram(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Telegram connection settings UI names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/NotionConnection.tsx', pattern: /^notion(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Notion OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/SettingsPage.tsx', pattern: /^notion(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Notion OAuth connection card in settings.' },
  { file: 'apps/chat-web/src/pages/Settings/useSettings.ts', pattern: /^(?:trello|github|telegram|notion|calendar|sheets)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Settings excludes personal OAuth services from shared credential list.' },
  { file: 'apps/chat-web/src/views/TelegramCallbackView.tsx', pattern: /^telegram(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Telegram callback view names that service.' },
  { file: 'apps/chat-web/src/views/NotionCallbackView.tsx', pattern: /^notion(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Notion callback view names that service.' },
];

function literals(source: string, ids: string[]) {
  const found: string[] = [];
  const names = ids.join('|');
  const exact = new RegExp('^(?:' + names + ')(?:\\.[A-Za-z_][\\w]*)?$');
  const embedded = new RegExp('["\\x27\\x60]((?:' + names + ')(?:\\.[A-Za-z_][\\w]*)?)["\\x27\\x60]', 'g');
  const tree = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (exact.test(node.text)) found.push(node.text);
      else for (const match of node.text.matchAll(embedded)) found.push(match[1]!);
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name) && ids.includes(node.name.text)) found.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'transports' || entry.name === '__tests__' ? [] : files(path);
    return /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : [];
  });
}

it('catches standalone ids, tool literals, object keys and embedded plan examples, excluding comments', () => {
  expect(literals("const a = 'demo'; const b = 'demo.list_things'; const c = { demo: 1 }; const d = " + '\x60{"tool":"demo.create_thing"}\x60' + "; // 'demo'", ['demo']))
    .toEqual(['demo', 'demo.list_things', 'demo', 'demo.create_thing']);
});
it('contains no service-specific core branches beyond exact documented exceptions', () => {
  const ids = SERVICE_REGISTRY.map(service => service.id);
  const violations = directories.flatMap(directory => files(join(root, directory))).flatMap(path => {
    const file = relative(root, path).replaceAll('\\', '/');
    return literals(readFileSync(path, 'utf8'), ids)
      .filter(value => !exceptions.some(exception => exception.file === file && exception.pattern.test(value)))
      .map(value => file + ': ' + value);
  });
  expect(violations).toEqual([]);
});
