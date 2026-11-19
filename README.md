<div align="center">

# Planora

**Chat-driven workflow automation across your team's tools, with a human approval gate on every write.**

**English** · [Tiếng Việt](README.vi.md)

[![v3 check](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml/badge.svg)](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml)
![Node.js](https://img.shields.io/badge/node-%5E22.12%20%7C%7C%20%3E%3D24-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

</div>

Planora turns a single request, written in Vietnamese or English, into a reviewed, multi-step workflow across Trello, GitHub, Slack, Jira, Notion, Google Workspace and Telegram. It answers read-only questions directly, drafts a plan for anything that writes to an external service, and runs that plan only after you approve the exact steps and destinations. Recurring digests deliver summaries from connected sources to Slack or Telegram on a schedule.

Planora is the v3 implementation of course project #26 in the ATI course (2026).

| Before approval | After execution |
| --- | --- |
| ![A three-step GitHub, Trello and Slack plan waiting for approval](docs/images/plan-review.png) | ![Receipt with the result of each workflow step](docs/images/receipt.png) |
| **Landing** | **Connections** |
| ![Planora landing page](docs/images/landing.png) | ![Service connections page](docs/images/settings.png) |

<sub>Screenshots use sandbox mode: fixture data and simulated service responses, no real API calls.</sub>

## Contents

- [Highlights](#highlights)
- [Example](#example)
- [Supported services](#supported-services)
- [How it works](#how-it-works)
- [Safety guarantees](#safety-guarantees)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Repository layout](#repository-layout)
- [Testing and evaluation](#testing-and-evaluation)
- [Project status](#project-status)
- [Contributing](#contributing)
- [Documentation](#documentation)
- [License](#license)

## Highlights

- **Plan, preview, approve, execute.** Every write is bound to the SHA-256 hash of the plan you reviewed (`plan_hash`). There is no path that writes without approval.
- **Grounded in your real resources.** The planner resolves names such as "the Sprint board" or "#ati-test" to real IDs through read-only search tools, and asks a follow-up question instead of guessing.
- **Multi-step, cross-service.** Later steps reuse earlier results through `$ref` and `$template`, so a Trello card can carry the link of the GitHub issue created one step earlier.
- **Honest failure handling.** A write whose outcome is unknown pauses the run in `needs_attention`. Planora never retries it automatically.
- **Scheduled digests and triggers.** Daily or weekly digests from Trello, GitHub, Jira, Sheets, Calendar and Gmail to Slack or Telegram, plus meeting-reminder and change-watch triggers for Google Calendar.
- **Personal and organization workspaces.** Personal OAuth connections stay with their owner; organization connections are scoped to a workspace and an explicit resource allowlist.
- **Runs offline.** Sandbox mode uses fixtures and needs no model key or provider credentials, which makes demos and browser tests reproducible.

## Example

> Tạo issue GitHub, thẻ Trello và thông báo Slack.
> *(Create a GitHub issue, a Trello card and a Slack notification.)*

Planora previews three steps. After you approve, it creates the GitHub issue, adds a Trello card that links to the issue, and posts a Slack message containing both links. The receipt records the result and the destination of each step.

Other requests it handles:

| Request | What happens |
| --- | --- |
| "Những thẻ nào trên bảng Sprint đã quá hạn?" | Read-only answer from Trello, no approval needed |
| "Mỗi sáng thứ Hai gửi bản tin issue Jira quá hạn vào #ati-test" | Previews a weekly digest schedule, then runs it automatically after approval |
| "Nhắc tôi 15 phút trước mỗi cuộc họp qua Telegram" | Previews a Google Calendar reminder trigger |
| "Soạn thư trả lời khách hàng và chờ tôi duyệt" | Drafts a Gmail reply and previews it before sending |

## Supported services

Tool counts are the tools declared in [`packages/tool-schemas`](packages/tool-schemas/). The set the planner actually sees depends on the workspace, the connection, the selected resources and the feature flags in `.env`.

| Service | Connection | Tools (read / write) | Typical actions |
| --- | --- | :---: | --- |
| Trello | Personal OAuth | 6 / 11 | Find boards and cards, create, move and update cards, labels, checklists |
| GitHub | Personal OAuth | 7 / 6 | Search issues and PRs, create issues, comment, request reviewers |
| Slack | Shared bot | 4 / 1 | Find channels and users, read messages and threads, send Block Kit messages |
| Slack (personal) <sup>1</sup> | Personal OAuth | 8 / 1 | Read your own channels and DMs, approved thread replies, proposal inbox |
| Telegram | Personal bot | 2 / 1 | Read recent chat messages (24 h store), send messages and digests |
| Jira | Personal OAuth (3LO) | 5 / 4 | Search projects and issues, create, update, comment, transition |
| Notion | Integration token or OAuth | 6 / 5 | Search pages, query databases, append blocks, comments |
| Google Sheets (org) | Service account | 5 / 4 | Read ranges, filter and aggregate rows, append and upsert |
| Google Sheets (personal) <sup>1</sup> | Personal OAuth | 7 / 8 | Picker-selected spreadsheets, plus Drive and Docs tools <sup>2</sup> |
| Google Calendar (personal) <sup>1</sup> | Personal OAuth | 5 / 5 | Recurring events, RSVP, reminder and change-watch triggers |
| Gmail <sup>1</sup> | Personal OAuth | 5 / 10 | Search and read mail, drafts, labels, reply, forward, trash (never permanent delete) |

<sup>1</sup> Off by default; enabled with its own `*_ENABLED` flag and OAuth client.
<sup>2</sup> The four Drive and Docs write tools stay blocked unless `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=on`.

Live verification per service is tracked in [`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md).

## How it works

```mermaid
flowchart LR
  U([Chat request]) --> R[Router<br/>service selection]
  R --> G[Gather<br/>resource directory +<br/>read-only search tools]
  G -->|read-only| A([Answer or<br/>clarifying question])
  G --> P[Planner<br/>LLM drafts a plan]
  P --> V[Validator<br/>schema · semantics ·<br/>security · grounding]
  V -->|plan + plan_hash| DB[(PostgreSQL)]
  DB --> W[Preview in chat-web]
  W -->|user approves| E[Executor<br/>ordered steps,<br/>$ref / $template]
  E --> T[Tool adapters<br/>allowlist · rate limit]
  T --> S([External services])
  E -.->|SSE progress| W
```

1. **Route and gather.** A router selects candidate services from the request. The planner loads a directory of resources the connection may touch, and the model calls read-only search tools to turn names into IDs. Supported read-only requests are answered directly.
2. **Plan and validate.** The model returns the whole plan in one response. The validator checks JSON shape, tool schemas, semantic rules, security constraints and grounding: every ID must come from a search result or from the user's own words.
3. **Preview and approve.** The plan is stored with its SHA-256 hash and an expiry. The preview shows each step and its destination. Approval is a compare-and-set on the pending plan, so a double click cannot run it twice.
4. **Execute and report.** Steps run in order with real `AbortSignal` timeouts. Progress streams to the browser over Server-Sent Events, and the receipt keeps the outcome of every step.
5. **Recover.** After a restart, runs that were in flight are reconciled before the API accepts traffic. Uncertain writes go to `needs_attention`, where a person checks the real service and marks the step as sent or starts a new run.

## Safety guarantees

These invariants are enforced in code and covered by tests. Changes that weaken them are not accepted.

| Guarantee | Mechanism |
| --- | --- |
| No write without approval | Execution requires an approved plan whose stored `plan_hash` matches the reviewed plan |
| No blind retries | An unknown write result moves the run to `needs_attention`; nothing resends it |
| Least privilege | Adapters reject any resource outside the connection's allowlist and the active workspace |
| Isolated credentials | Personal and organization credentials never cross workspaces; secrets are encrypted at rest with AES-256-GCM |
| Safe schema changes | Database migrations are additive and idempotent; merged migrations are never edited |

Delivery to Slack, Telegram and Gmail is at-most-once, not exactly-once: when the outcome is unclear, Planora stops and asks rather than risk a duplicate message.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web app | React 19, Vite 8, Tailwind CSS 4, Zustand, Server-Sent Events |
| API | Node.js, TypeScript, Express 5, JWT (HS256) sessions, Google sign-in |
| Planning | Gemini, DeepSeek or any OpenAI-compatible `/v1/chat/completions` gateway |
| Data | PostgreSQL 16 with numbered SQL migrations in [`db/v3`](db/v3/) |
| Testing | Vitest, Playwright, golden-set evaluations |
| CI | GitHub Actions on Ubuntu, Node 24, PostgreSQL 16 |

## Getting started

### Prerequisites

- Node.js `^22.12` or `>=24`, with npm
- Docker with Compose (for the local PostgreSQL container)

### Run in sandbox mode

Sandbox mode uses fixture data, so no model key or service credentials are needed. Run the commands from the repository root.

```sh
npm ci
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run db:up:v3              # PostgreSQL 16 on 127.0.0.1:55533
```

Set these values in your local `.env`. Pick an admin password of at least 12 characters.

```dotenv
RUNTIME_MODE=sandbox
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3
CHAT_ADMIN_EMAIL=admin@localhost.test
CHAT_ADMIN_PASSWORD=<your-local-password>
SANDBOX_SCENARIO=three_service
```

Then migrate, create the admin account once, and start the API and web app:

```sh
npm run db:migrate:local:v3
npm run admin:provision:local:v3
npm run up:local:v3
```

Open <http://127.0.0.1:5174>, sign in with the admin account and send the [example request](#example). The API health check is at <http://127.0.0.1:3000/api/health>.

Remove `SANDBOX_SCENARIO` and restart to use the default sandbox. Stop the app with <kbd>Ctrl</kbd>+<kbd>C</kbd>; `npm run db:down:v3` stops PostgreSQL and keeps its data volume. The [local setup guide](docs/V3-LOCAL-SETUP.md) covers database and test details.

### Run in live mode

Live mode talks to real services. In your local `.env`:

1. Set `RUNTIME_MODE=live`, `DATABASE_URL`, `JWT_SECRET` and `ENCRYPTION_KEY`.
2. Configure one planning model: `GEMINI_API_KEY`, or `LLM_PROVIDER=deepseek` with `DEEPSEEK_API_KEY`, or `LLM_PROVIDER=openai-compatible` with `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`.
3. Register OAuth apps for the services you plan to use and enable the opt-in ones (`GMAIL_ENABLED`, `MYCALENDAR_ENABLED`, `MYSHEETS_ENABLED`, `MYSLACK_ENABLED`, `MYJIRA_ENABLED`). Each Google integration needs its own Google Cloud project.

```sh
npm run db:migrate:v3
npm run admin:provision:v3
npm run up
```

Every variable is documented in [`.env.example`](.env.example). Never commit `.env` or put secrets in prompts, logs or evidence files. For controlled runs against real services, see [`evaluations/README.md`](evaluations/README.md).

## Repository layout

```text
.
├── apps/
│   ├── chat-web/        React + Vite app: chat, previews, connections, schedules, history
│   └── chat-api/        Express API: auth, workspaces, conversations, execution, schedules
├── packages/
│   ├── tool-schemas/    Service registry, tool definitions and shared types
│   ├── tool-adapters/   Service API clients, scope enforcement, rate limiting, encryption
│   ├── planner/         Routing, resource lookup, LLM providers, plan validation
│   └── executor/        Ordered execution, step references, failure handling
├── db/v3/               PostgreSQL migrations and the migration runner
├── evaluations/         Golden sets, offline scoring and controlled live evaluation
├── prompts/             Prompt templates
├── scripts/             Launcher, local-environment guards and test runners
└── docs/                Design, handoff, runbooks and reports
```

## Testing and evaluation

| Command | Purpose |
| --- | --- |
| `npm run typecheck:v3` | Type-check the API and the web app |
| `npm run test:v3` | Unit and integration tests (PostgreSQL tests use `DATABASE_URL`) |
| `npm run test:eval:v3` | Offline evaluation logic |
| `npm run test:browser:v3` | Playwright end-to-end tests against the sandbox app |
| `npm run check` | Full suite: type-check, tests, evaluations, web build and launcher checks |
| `npm run check:local:v3` | Full suite behind the local sandbox database guard |

Browser tests need Chromium (`npx playwright install chromium`), a dedicated sandbox database with a provisioned admin, and no `SANDBOX_SCENARIO` in `.env`, so the runner can pick its own fixtures. Stop the app first so Playwright can start its own servers.

Planner and prompt changes are measured against golden sets in [`evaluations/`](evaluations/), both offline and with a real model. CI runs the `check` and `browser` jobs in parallel on every pull request ([workflow](.github/workflows/v3-check.yml)).

## Project status

- Core flow (chat, plan, approve, execute, receipt) and scheduled digests run in both sandbox and live mode.
- Every service in the table above has been exercised against real accounts in a test workspace. Remaining live checks per service are listed in [`CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md).
- **Not yet deployed to production.** Google OAuth projects in Testing mode expire refresh tokens after 7 days, so reconnect shortly before a demo.

Planned work lives in the [roadmap](docs/handoff/ROADMAP.md).

## Contributing

1. Read the [team workflow](docs/team-workflow.md) and the [repository rules](AGENTS.md), including the safety invariants.
2. Branch from `origin/main` as `feat|fix|chore|docs/<short-name>` and use [Conventional Commits](https://www.conventionalcommits.org/).
3. Add tests for the behavior you change; a bug fix comes with a test that reproduces the bug.
4. Run the tests for the area you touched and `npm run typecheck:v3`, then open a pull request describing what changed, why, and how it was tested.

Pull requests that touch migrations, OAuth or tokens, real send or write paths, data deletion or CI need a second review before merge ([checklist](docs/handoff/REVIEW-CHECKLIST.md)).

## Documentation

| Document | Contents |
| --- | --- |
| [v3 design spec](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Architecture and the reference business behavior |
| [Current state](docs/handoff/CURRENT-STATE.md) | Status and live verification per service |
| [Local setup](docs/V3-LOCAL-SETUP.md) | Database, sandbox and test environment details |
| [Evaluations](evaluations/README.md) | Golden sets and controlled live runs |
| [Documentation index](docs/README.md) | Everything else: ADRs, runbooks, reports |

## License

This repository does not have an open-source license yet. All rights are reserved by the project team.
