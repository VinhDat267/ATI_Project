# ATI: AI Workflow Automation Platform

**English** · [Tiếng Việt](README.vi.md)

[![v3 check](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml/badge.svg)](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml)
![Node.js](https://img.shields.io/badge/node-%5E22.12%20%7C%7C%20%3E%3D24-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6)

Describe a task in one Vietnamese or English sentence. ATI finds the right boards, channels and repositories, drafts a multi-step plan across your connected tools, and runs it only after you approve.

ATI is the course project for topic #26 of the ATI course (2026), built by a small team with AI coding agents. The current codebase is **v3**: a chat agent with plan-then-execute tool orchestration.

| Plan review | Receipt |
|---|---|
| ![A three-step plan waiting for approval](docs/images/plan-review.png) | ![Receipt after the plan ran on GitHub, Trello and Slack](docs/images/receipt.png) |
| **Landing** | **Service connections** |
| ![Landing page](docs/images/landing.png) | ![Service connections page](docs/images/settings.png) |

*Screenshots are from sandbox mode, which uses a canned plan and does not call real services.*

## Contents

- [How it works](#how-it-works)
- [Supported services](#supported-services)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Project status](#project-status)
- [Working on this repository](#working-on-this-repository)
- [Documentation](#documentation)

## How it works

```mermaid
flowchart LR
  U([User message]) --> R[Router<br/>keyword rules]
  R --> P[Planner<br/>resource prefetch,<br/>LLM + search tools]
  P --> V[Validator<br/>json · schema · semantic<br/>security · grounding]
  V -->|plan + SHA-256 hash| DB[(PostgreSQL)]
  DB --> W[Plan review<br/>in chat-web]
  W -->|approve| E[Executor<br/>sequential, $ref / $template]
  E --> A[Tool adapters<br/>allowlist, rate limit]
  A --> S([Trello · Slack · GitHub · Sheets<br/>Calendar · Notion · Telegram · Jira])
  E -.->|SSE progress| W
```

1. **Understand.** A keyword router selects candidate services. The planner prefetches a directory of allowed resources, and the model can call read-only search tools to turn names into real IDs. If the request is ambiguous or read-only, ATI asks a follow-up question instead of guessing.
2. **Plan.** The model returns the whole plan in one response. A five-layer validator checks it: JSON, schema, semantics, security and grounding (every ID must come from a search result or from the user's own words). A plan with no write step is rejected.
3. **Approve.** The plan is stored with a SHA-256 hash and expires after 30 minutes. The user sees each step and its destination, and can approve, cancel, or revise through chat. Approval is a compare-and-set on `status = 'pending'`, so a double click cannot run a plan twice.
4. **Execute.** Steps run in order. Outputs feed later steps through `$ref` and `$template`, timeouts use a real `AbortSignal`, and progress streams to the browser over SSE.

**Write safety.** If a write step times out or fails in a way where the result is unclear, the step becomes `unknown` and the plan pauses. ATI never retries such a write on its own; the user checks the real service and then skips the step or stops the plan. After a restart, plans that were running are reconciled the same way before the API accepts traffic.

## Supported services

The catalog has 33 tools across 8 services: 19 read and 14 write.

| Service | Tools | Typical writes |
|---|---:|---|
| Trello | 9 | create/update card, add member, add checklist |
| GitHub | 5 | create issue, add label |
| Google Sheets | 4 | append rows |
| Notion | 4 | create page, append text |
| Jira | 4 | create issue, add comment |
| Google Calendar | 3 | create event (no attendee invites) |
| Slack | 2 | send message |
| Telegram | 2 | send message |

Every adapter refuses resources outside the allowlist an admin configured. Service credentials are encrypted at rest with AES-256-GCM. How far each service has been verified (sandbox, live script, live through the UI) is tracked in [CURRENT-STATE](docs/handoff/CURRENT-STATE.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Zustand, `fetch-event-source` |
| Backend | Node.js 22+, Express 5, PostgreSQL 16 (`pg`), Nodemailer |
| AI | Gemini (`@google/genai`) or any OpenAI-compatible gateway; currently `ag/gemini-3.8-flash` through a local 9router |
| Auth | JWT access tokens + rotating refresh tokens stored as SHA-256, email verification with admin approval, Google OIDC (PKCE) |
| Testing | Vitest, Testing Library, Playwright (Chromium) against a real PostgreSQL |
| Tooling | npm workspaces, TypeScript 5, GitHub Actions |

## Repository layout

```text
ATI_Project/
├── apps/
│   ├── chat-api/        Express API: auth, conversations, approval, execution, SSE
│   └── chat-web/        React app: landing, auth, cockpit, settings, history, guide
├── packages/
│   ├── tool-schemas/    Shared types, tool catalog, service registry
│   ├── tool-adapters/   One adapter per service, allowlists, encryption, rate limits
│   ├── planner/         Router, working memory, prompts, providers, validator
│   └── executor/        Sequential executor, $ref/$template, timeouts, unknown state
├── db/v3/               PostgreSQL migrations 0001–0008 (11 tables) and runner
├── evaluations/         Golden sets, offline scorer, controlled live runs
├── scripts/             Launcher, test runners, fake OIDC provider for tests
├── docs/                Specs, plans, handoff notes, design prototypes, evidence
└── compose.v3.yaml      Local PostgreSQL 16
```

Code from v1/v2 was removed from `main` on 2026-10-05. The tag `archive/v2-final` keeps the last snapshot; read a file with `git show archive/v2-final:<path>`.

## Getting started

### Prerequisites

- Node.js `^22.12` or `>=24`, npm
- Docker with Compose (for PostgreSQL)
- Chromium for browser tests: `npx playwright install chromium`, once

### 1. Install and configure

```bash
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

`.env` is ignored by Git. Never commit it or paste its values into logs, issues or PRs.

### 2. Run in sandbox with PostgreSQL (recommended)

Sandbox mode uses a canned planner and fake service responses, so it calls no model and no real service.

```bash
npm run db:up:v3            # PostgreSQL 16 on 127.0.0.1:55533
```

In `.env`, keep `RUNTIME_MODE=sandbox` and set:

```dotenv
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3
CHAT_ADMIN_EMAIL=admin@localhost.test
CHAT_ADMIN_PASSWORD=<a local password, at least 12 characters>
```

Then migrate, create the account once, and start the app:

```bash
npm run db:migrate:local:v3
npm run admin:provision:local:v3
npm run up:local:v3
```

Open <http://127.0.0.1:5174> and sign in with `CHAT_ADMIN_*`. API health is at <http://127.0.0.1:3000/api/health>. `npm run db:down:v3` stops the container and keeps its volume.

The `:local:v3` commands refuse to run unless `DATABASE_URL` points at this local container. On Windows, if port 55533 falls inside a range the system has reserved, set `V3_LOCAL_DB_PORT` to another port (for example 56533) and use that port in `DATABASE_URL`. Details: [V3-LOCAL-SETUP](docs/V3-LOCAL-SETUP.md).

### Quick look without a database

Leave `DATABASE_URL` as in `.env.example` (it points at an unreachable port, so data stays in memory), set `SANDBOX_USER_EMAIL` and `SANDBOX_USER_PASSWORD`, and run `npm run up`.

### Live mode

Live mode calls the real model and real services. It needs:

- a real PostgreSQL in `DATABASE_URL`;
- `JWT_SECRET` (at least 32 bytes) and `ENCRYPTION_KEY` (32 bytes or 64 hex characters);
- an LLM: `GEMINI_API_KEY`, or `LLM_PROVIDER=openai-compatible` with `LLM_BASE_URL`, `LLM_API_KEY` and one pinned `LLM_MODEL`;
- `CHAT_ADMIN_*`, then `npm run db:migrate:v3` and `npm run admin:provision:v3`.

Start with `RUNTIME_MODE=live npm run up`. Live mode refuses to start when required settings are missing. SMTP and Google OAuth are optional; see the comments in [`.env.example`](.env.example) and the "Through the app" section of [evaluations/README.md](evaluations/README.md). Add service keys and resource allowlists on the **Service connections** page. Only write to real services through plans you have reviewed, and use test boards, channels and repositories.

## Testing

| Command | What it runs |
|---|---|
| `npm run check` | Typecheck, unit and integration tests for all six workspaces, offline evaluation tests, web build, a scan of the built bundle for secrets, launcher and env tests |
| `npm run test:browser:v3` | Playwright E2E on the real API, web app and PostgreSQL, in 11 sandbox scenarios. Needs a provisioned database (step 2 above) |
| `npm run check:local:v3` | `check` with the guard that `DATABASE_URL` is the local container |

CI ([`v3-check.yml`](.github/workflows/v3-check.yml)) runs `npm ci`, migrations, `npm run check` and the browser suite on a fresh PostgreSQL 16 for every pull request and every push to `main`.

As of 2026-10-11 (CI on `828c21a`): **1,674** unit and integration tests, **173** evaluation tests, **101** browser tests across 11 scenarios (one more is skipped by design).

To run one browser test directly while its servers start from the Playwright config:

```bash
node node_modules/playwright/cli.js test --config apps/chat-web/playwright.config.ts --grep "FE-11:"
```

## Project status

[`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md) is the source of truth for status, measurements and known issues. Each number there has a date and a commit. In short, as of 2026-10-11:

- **Done:** all 8 services with adapters, accounts (email signup with admin approval, Gmail SMTP, Google login, session management), and the redesigned interface (FE-04 → FE-11).
- **Measured with the real model** (2026-10-08, three runs per set): core 150/150 correct, free-form 52/54, multi-service 129/132.
- **Not yet met:** the 15-second p95 latency target for multi-service requests (20.1 s). The usable-plan rate with real users has not been measured yet.
- **Next:** the LLM fallback path (W4-00), running the five newer services live through the UI (W3-11), and the week-4 evaluations. See the [roadmap](docs/handoff/ROADMAP.md).

Production readiness has not been claimed.

## Working on this repository

Several people and AI agents (Codex, Claude Code and others) work here, and none of them remember each other's sessions. Shared memory lives in [`docs/handoff/`](docs/handoff/README.md).

1. **Before you start**, read `CURRENT-STATE.md` and the three newest files in `docs/handoff/log/`, then run `git status`. If the folder has changes that are not yours, work in a separate `git worktree`.
2. **Take one task card** from [`docs/handoff/tasks/`](docs/handoff/tasks/), on its own branch. Write the failing test first. Database logic is tested on real PostgreSQL and timeouts with a real `AbortSignal`; no mocks that only pretend.
3. **Finish** by filling in the task card's result section and adding one new file to `docs/handoff/log/` in the same PR. Do not edit `CURRENT-STATE.md` or `ROADMAP.md`; the reviewer updates them after merge.
4. **Review and merge.** An independent reviewer reruns the tests and follows [`REVIEW-CHECKLIST.md`](docs/handoff/REVIEW-CHECKLIST.md). A PR merges only when CI is green and the review passes.

Conventions:

- Conventional Commits; `git add` only the files of your task.
- PR descriptions follow [the template](.github/pull_request_template.md), with the files changed, real test output and commit hashes.
- Module ownership and branch strategy: [`docs/team-workflow.md`](docs/team-workflow.md). Rules for AI agents: [`AGENTS.md`](AGENTS.md).
- This repository is public. Never commit `.env`, tokens, live-run evidence (`docs/ai-evidence/V3-LIVE-EXECUTION/`, `docs/ai-evidence/AUTH-LIVE/`) or course reports.

## Documentation

| Document | Purpose |
|---|---|
| [CURRENT-STATE](docs/handoff/CURRENT-STATE.md) | Where the project is: numbers, recent merges, known issues, decisions |
| [ROADMAP](docs/handoff/ROADMAP.md) and [task cards](docs/handoff/tasks/) | What is next and how each task is accepted |
| [v3 design spec](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Authoritative behavior, flows, tool catalog and schema |
| [UI redesign spec](docs/superpowers/specs/2026-10-05-ui-redesign-agentic-design.md) and [design system](docs/design/design-system.md) | The Agentic interface and its 12 prototypes |
| [Multi-service scope](docs/MULTI-SERVICE-SCOPE.md) | Acceptance criteria for adding services |
| [Evaluations](evaluations/README.md) | Golden sets, scoring and controlled live runs |
| [Local setup](docs/V3-LOCAL-SETUP.md) | PostgreSQL sandbox step by step |
| [Docs index](docs/README.md) | Everything else, including the original topic documents |

No open-source license has been chosen for this project.
