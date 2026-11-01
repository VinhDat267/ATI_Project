import { expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { SERVICE_REGISTRY } from '@wap/tool-schemas';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directories = ['packages/planner/src', 'packages/executor/src', 'apps/chat-api/src/routes', 'apps/chat-api/src/services', 'apps/chat-web/src'];
const exceptions = [
  { file: 'packages/planner/src/validator.ts', pattern: /^trello\.(create_card|add_member)$/, reason: 'Trello board membership business rule; explicit W3-00 exception.' },
  { file: 'packages/planner/src/prompts/system-prompt.ts', pattern: /^(trello\.(create_card|add_member)|slack\.send_message)$/, reason: 'Catalog-gated example; keep prompt and golden comparability.' },
  { file: 'apps/chat-web/src/components/MissionControlLaunchpad.tsx', pattern: /^(trello\.(create_card|add_member|add_checklist|search_boards|search_cards)|slack\.(send_message|search_channels)|github\.search_issues)$/, reason: 'Existing sample workflows, registered-tool availability checked by FE-01; frontend naming follows W3-00b.' },
  { file: 'apps/chat-web/src/components/LandingPage.tsx', pattern: /^(trello|slack|github)$/, reason: 'Introduction display strings, permitted by task.' },
  { file: 'apps/chat-web/src/components/LoginPage.tsx', pattern: /^(trello|slack|github)$/, reason: 'Login display strings, permitted by task.' },
  { file: 'apps/chat-web/src/pages/Guide/data.tsx', pattern: /^(?:trello|slack|github|sheets|calendar|notion|telegram|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'FE-10 presentation content; every declared tool is checked against the live catalog.' },
  { file: 'apps/chat-web/src/pages/Guide/mysheets-data.tsx', pattern: /^(?:trello|slack|github|sheets|calendar|notion|telegram|jira)(?:\.[A-Za-z_][\w]*)?$/, reason: 'OAUTH-03 presentation content; sample prompts for personal sheets workflows.' },
  { file: 'apps/chat-api/src/routes/connections/trello.ts', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/connections/mysheets.ts', pattern: /^sheets(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Google Sheets OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/connections/github.ts', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/routes/services-routes.ts', pattern: /^(?:trello|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello/GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/services/adapter-factory.ts', pattern: /^(?:trello|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello/GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/services/chat-service.ts', pattern: /^(?:trello|sheets|calendar|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal OAuth and digest candidate evaluation names those services.' },
  { file: 'apps/chat-api/src/services/schedules/sheets-digest-candidate.ts', pattern: /^(?:sheets|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Sheets digest candidate checks sheets read source and slack/telegram destination.' },
  { file: 'apps/chat-api/src/services/schedules/sheets-digest-runner.ts', pattern: /^(?:sheets|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Sheets digest runner reads sheets and delivers to slack/telegram.' },
  { file: 'apps/chat-api/src/services/schedules/calendar-digest-candidate.ts', pattern: /^(?:calendar|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Calendar digest candidate checks calendar read source and slack/telegram destination.' },
  { file: 'apps/chat-api/src/services/schedules/calendar-digest-runner.ts', pattern: /^(?:calendar|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Calendar digest runner reads calendar and delivers to slack/telegram.' },
  { file: 'apps/chat-api/src/services/schedules/github-digest-candidate.ts', pattern: /^(?:github|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled GitHub-to-Slack digest candidate validation.' },
  { file: 'apps/chat-api/src/services/schedules/github-digest-runner.ts', pattern: /^(?:github|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Scheduled GitHub-to-Slack digest execution.' },
  { file: 'apps/chat-api/src/services/schedules/schedule-service.ts', pattern: /^(?:sheets|calendar|github|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Digest schedule confirmation checks service kind.' },
  { file: 'apps/chat-api/src/services/registered-services.ts', pattern: /^(?:trello|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello/GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/services/trello/connection-reference.ts', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-api/src/services/trello/token-manager.ts', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-api/src/services/github/connection-reference.ts', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-api/src/services/github/token-manager.ts', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx', pattern: /^(?:trello|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello/GitHub OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx', pattern: /^(?:sheets|calendar|github|slack|telegram)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Digest schedule confirmation displays destination service.' },
  { file: 'apps/chat-web/src/pages/Responses/ResponseMoment.tsx', pattern: /^(?:trello|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello/GitHub OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/TrelloConnection.tsx', pattern: /^trello(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/GitHubConnection.tsx', pattern: /^github(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal GitHub OAuth names that service.' },
  { file: 'apps/chat-web/src/pages/Settings/useSettings.ts', pattern: /^(?:trello|github)(?:\.[A-Za-z_][\w]*)?$/, reason: 'Personal Trello/GitHub OAuth names that service.' },
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
