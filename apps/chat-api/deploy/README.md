# Planora account/workspace backend

This deployment entry point reuses the v3 PostgreSQL authentication and conversation APIs. It is intended to let the public Planora frontend sign in and manage its workspace while AI and email credentials are being prepared.

## Capabilities

| Available | Not enabled by this entry point |
| --- | --- |
| Password login for provisioned, active, verified accounts | Public signup and verification email |
| Persisted sessions, refresh rotation, logout revocation | Google sign-in |
| Account settings and password changes | AI planning and workflow execution |
| Owner-scoped conversation history, archive, soft-delete, restore | Synthetic plans, demo accounts, memory storage |
| Service configuration stored with encryption and role checks | Unapproved external writes |

Sending a message without a planner returns `503 PLANNING_NOT_CONFIGURED` before saving it. `/api/health` reports the actual capability flags. The existing full `src/server.ts` runtime is unchanged and remains the source for the complete planner/executor deployment after its dependencies are configured. This release does not certify the full v3 product scope.

## Render Free + Neon PostgreSQL

Use the committed branch containing this task, with repository root as the Render root directory. Existing unrelated Render services must not be modified.

- Region: Singapore.
- Runtime: Node.js 24.14.0.
- Build: `npm ci --include=dev && node apps/chat-api/deploy/build.mjs`
- Start: `node db/v3/migrate.mjs && node apps/chat-api/deploy/dist/server.mjs`
- Readiness: `/api/ready` (queries PostgreSQL); liveness: `/api/health`.
- Blueprint: `apps/chat-api/deploy/render.yaml`, using `plan: free` explicitly.

Required private environment:

| Variable | Value / rule |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.14.0` |
| `APP_BASE_URL` | `https://planora-ivory-tau.vercel.app/` |
| `DATABASE_URL` | New Neon database connection string with TLS; never the local development database |
| `JWT_SECRET` | Random private secret, at least 32 bytes |
| `ENCRYPTION_KEY` | Random 32-byte key represented as 64 hex characters; Render-generated 256-bit base64 is normalized to the same bytes |
| `PORT` | Render supplies this; default 10000 |

Secrets belong in hosting environment settings or ignored local files, never in the Blueprint, client code, commit, screenshots, or public test logs. The build bundles only the account/workspace entry point; it does not load environment files or embed credentials. Database migrations are idempotent and transactional under the existing advisory lock.

Render Free sleeps after 15 minutes without inbound traffic and takes about one minute to wake. Its filesystem is ephemeral; all account, session and conversation persistence here is in Neon. Free compute is suitable for initial use; it is not an always-on service. See [Render Free documentation](https://render.com/docs/free). Signup email is deliberately closed; no local outbox is presented as actual delivery.

## First administrator

Create a new owner account against the cloud database using the existing private CLI:

`node --env-file=<private-provisioning-file> --import tsx apps/chat-api/src/cli/provision-user.ts`

The private file needs `DATABASE_URL`, `CHAT_ADMIN_EMAIL`, a random `CHAT_ADMIN_PASSWORD` of at least 12 characters, and optional `CHAT_ADMIN_NAME`. This stores a salted hash, sets the administrator active/verified, and prints no password. Running it against an existing email changes its password and revokes sessions, so use it deliberately. Do not import or publish a local demo administrator. Do not persist the plaintext provisioning password in Render runtime settings.

## Frontend connection

After the Render readiness check succeeds, replace the frontend's `/api/:path* → /api/unavailable` rewrite with `/api/:path* → https://<verified-render-host>/api/:path*`. Keep the SPA fallback last. Remove the unavailable function only in that validated frontend release. Use the same-origin proxy for auth and SSE; no credentials go into `VITE_*` variables.

Verify through the live frontend: login, workspace history, create conversation, reload, settings, logout, rejection of revoked token, and the explicit unconfigured-planner response. Do not test real provider writes as part of login deployment.

## Local verification

- `node apps/chat-api/deploy/build.mjs`
- `node node_modules/typescript/bin/tsc -p apps/chat-api/tsconfig.json --noEmit`
- `node node_modules/vitest/vitest.mjs run apps/chat-api/tests/config/cloud-workspace.test.ts`
- For real database tests, set `CLOUD_TEST_DATABASE_URL` to a designated disposable local test database, then run `apps/chat-api/tests/integration/cloud-workspace.test.ts`. The suite creates and verifies a unique `deploy02_*` schema and drops only that schema. Never use production for the regression suite.
