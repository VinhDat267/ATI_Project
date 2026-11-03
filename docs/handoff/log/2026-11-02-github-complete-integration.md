# Handoff Log — GitHub Full-Stack Enhancement (Gói A + Gói B Backend, UI/UX Overhaul & Playwright E2E)

- **Ngày:** 2026-11-02
- **Nhánh:** `feat/github-complete-integration` (worktree `.claude/worktrees/github-complete`)
- **Phạm vi:**
  1. **Backend — Gói A (Khắc phục 8 điểm nghẽn kỹ thuật, UX & Liên dịch vụ `F1` → `F8`):**
     - Mở rộng `gatherRules[0].pattern` trong `packages/tool-schemas/src/registry/github.ts` để nhận diện cả `"repo owner/name"` lẫn tên ngắn `"repo ATI_Project"`.
     - Bổ sung `github.list_issues` trong `GitHubAdapter` (`packages/tool-adapters/src/github/github-adapter.ts`) để liên thông trực tiếp với `TelegramDigestRunner` (`{ state: 'open' }` trên toàn bộ `allowedRepositories()`).
     - Truyền `repo: (step as any).repo` trong `StepRunner.executeStep` (`packages/executor/src/runner.ts`) và kiểm tra thu hồi quyền trực tiếp theo `context.repo` trong `AdapterFactory.githubAdapter` (`apps/chat-api/src/services/adapter-factory.ts`).
     - Tự động chuẩn hóa tên repo ngắn sang `owner/repo` và gán vào cả `step.repo` lẫn `step.args.repo` trong `ChatService.bindConnections` (`apps/chat-api/src/services/chat-service.ts`).
     - Sửa nhánh fallback của `getToolCatalogFor` trong `apps/chat-api/src/services/registered-services.ts` (`githubTeamRepo.repos()`, `{ accessToken, refreshToken }`, `cr.member !== false`).
     - Kết nối `provider.generateText` vào `summarizeDigest` khi khởi tạo `createGithubDigestRunner` trong `apps/chat-api/src/server.ts` và chuẩn hóa `GITHUB_FAKE` (`apps/chat-api/src/sandbox/fake-results/github.ts`).
  2. **Backend — Gói B (Mở rộng 9 công cụ GitHub OAuth & Hỗ trợ `github_digest` qua Telegram):**
     - Định nghĩa `GITHUB_OAUTH_TOOLS` trong `packages/tool-schemas/src/github.ts` (`github.get_pull_request`, `github.update_issue`, `github.add_comment`, `github.list_issues`) và hỗ trợ `assignees` trong `github.create_issue` (bảo toàn nguyên vẹn `ALL_TOOLS = 33` và `GITHUB_TOOLS = 5`).
     - Mở rộng `GithubDigestConfig`, `GithubDigestDelivery`, `evaluateGithubDigestCandidate` và `createGithubDigestRunner` hỗ trợ gửi bản tin 3 mục (Issue mới, PR chờ review quá N ngày, Issue chưa ai nhận) sang cả **Slack** lẫn **Telegram**.
  3. **Frontend UI/UX (`FE-GH-1` → `FE-GH-6` tại `apps/chat-web`) & Kiểm thử Playwright E2E:**
     - Khai báo đầy đủ metadata hiển thị cho cả 9 công cụ GitHub trong `apps/chat-web/src/assets/cockpit-services.json` và `tool-definitions.ts`.
     - Sửa `resourceDestination` trong `Cockpit.tsx` hiển thị `"owner/repo · #42"` thay vì `"Issue · chưa có tên trong dữ liệu"`.
     - Việt hóa nhãn trường và bổ sung dải badge trực quan (`Đã đóng (closed)` / `Đang mở (open)`, `#label`, `@assignee`) trong `PreviewContents.tsx`, `recovery-labels.json`, `ExecutionProgress.tsx`.
     - Hỗ trợ hiển thị đích nhận Telegram (`Telegram: <Tên nhóm>`) và Slack (`#channel`) cho `github_digest` trong `ScheduleMoment.tsx` và `ScheduleSection.tsx`.
     - Nâng cấp `GitHubConnection.tsx` với trạng thái `loadingCandidates`, bộ đếm `Đã chọn X/10`, nhãn `Private` / `Public`, ô tìm kiếm nhanh repository, và điều hướng `needs_scope` / `needs_membership` trong `ResponseMoment.tsx`.
     - Mở rộng kịch bản Playwright E2E trong `apps/chat-web/tests/browser/github-oauth-and-digest.spec.ts`.

## Kết quả Kiểm thử Thực tế (Verification Evidence)

- `npm test --workspace=@wap/tool-schemas`: **17/17 files, 341/341 tests PASS** (exit code `0`).
- `npm test --workspace=@wap/planner`: **27/27 files, 381/381 tests PASS** (exit code `0`).
- `npx --workspace=@wap/tool-adapters vitest run tests/github-adapter.test.ts`: **17/17 tests PASS** (exit code `0`).
- `npm test --workspace=@wap/executor`: **5/5 files, 43/43 tests PASS** (exit code `0`).
- `apps/chat-api` (`npx tsc --noEmit` + GitHub & Digest suites): **6/6 files, 38/38 tests PASS, 0 lỗi TS** (exit code `0`).
- `apps/chat-web` (`npx tsc --noEmit` + `github-connection.test.tsx`, `schedule-github-digest-mode.test.tsx`, `fe-05-cockpit.test.tsx`): **3/3 files, 54/54 tests PASS, 0 lỗi TS** (exit code `0`).
- **Playwright Browser E2E (`scripts/test-v3-browser.mjs` trên Chromium + PostgreSQL `ati_v3`):**
  - `tests/browser/github-oauth-and-digest.spec.ts`: **2/2 E2E flows PASS (25.5s, 0 external requests)**
  - `SCENARIO=three_service` (`GitHub → Trello → Slack` trong `v3-sandbox.spec.ts`): **1/1 E2E flow PASS (9.9s)**
