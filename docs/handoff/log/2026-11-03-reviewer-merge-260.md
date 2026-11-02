# Reviewer merge GitHub #260 · 03/11/2026

Chủ dự án yêu cầu merge [PR #260](https://github.com/VinhDat267/ATI_Project/pull/260) (`feat/github-complete-integration`) vào `main` và cập nhật tài liệu bàn giao sau khi đợt re-review độc lập cuối tại head `ec31403d` đạt và CI xanh đúng head.

## Gate và kết quả

- **Head cuối:** `ec31403d668d64241fa2f25a4b2367feb1a82610` trên nền `2b78f4b695856a61a8063b2595cf6c8ddaed413a` (`main`). Giữa base `2b78f4b6` và `origin/main` `1977ec7d` (đã hợp nhất #255, #257, #258 cho Jira) không có file trùng lặp với 37 file thay đổi của PR #260.
- **Chuỗi review độc lập & đóng lỗi:**
  - Review lần 1 trên `d250872d`: phát hiện 6 finding (`F1`–`F6`) và lỗi fallback repo catalog; sửa tại `b785545b` (đưa đủ 9 tool `GITHUB_OAUTH_TOOLS` vào planner catalog khi kết nối GitHub OAuth cá nhân, hỗ trợ `assignees` trong validator cho `github.create_issue`, khóa identity Telegram và `staleDays` vào `github_digest` config/hash, truyền đúng `TelegramConnectionSnapshot` vào `AdapterFactory`, chặn gửi sau khi cancel/pause và từ chối ordinary issue trong `github.get_pull_request`).
  - Re-review lần 2 trên `b785545b`: 6 ca tái hiện cũ và fallback đã PASS, phát hiện 2 P1 mới (`R1`: race hủy/pause khi SQL đánh dấu gửi đang chờ khóa; `R2`: `SlackAdapter` trả `NETWORK` khi mất phản hồi làm xóa marker và cho replan gửi trùng); sửa tại `a742970a` bằng `claimGithubDigestDelivery` đồng bộ đúng thứ tự khóa `conversations -> schedules -> schedule_runs FOR UPDATE NOWAIT` (nếu vướng `55P03` thì `ROLLBACK` nhả khóa `c, s` rồi chờ khóa `schedule_runs` và đọc lại snapshot mới) cùng `isDefiniteWriteRejection`.
  - Re-review lần 3 trên `a742970a`: `R1` và `R2` đã PASS, phát hiện 1 P1 (`C1`: `err.details.ok === false` ghi đè phân loại `UNKNOWN` cho `internal_error` / `fatal_error` của Slack) và 1 lỗi strict-mode locator trên mobile Playwright; sửa tại `ec31403d` (bỏ `err.details.ok === false` khỏi `isDefiniteWriteRejection` để bảo toàn `UNKNOWN` → giữ `delivery_started_at` → `needs_attention` → chặn replan, mở rộng Test 10 lên ma trận 8 ca Slack contract và sửa selector `.first()`).
  - Re-review lần 4 trên `ec31403d`: **Đạt phần code/offline**, không còn finding P1/P2/P3 trong phạm vi kiểm tra.
- **CI:** [Run #41498564358](https://github.com/VinhDat267/ATI_Project/actions/runs/41498564358) SUCCESS đúng head `ec31403d668d64241fa2f25a4b2367feb1a82610` (`11m44s`, gồm `npm run check` và browser E2E).
- **Merge:** thực thi `gh pr merge 260 --merge --match-head-commit ec31403d668d64241fa2f25a4b2367feb1a82610`. Merge commit `0661b7596703cd14da22904b6c945ac8461496bb` lúc `2026-11-02T23:24:18Z` (`06:24:18 +07` ngày `03/11/2026`), tree `a40b762f2290b1af32d7b801fffb102f1d553c94`.

## Bằng chứng kiểm thử

```text
Trên head ec31403d668d64241fa2f25a4b2367feb1a82610:
- Probe các lỗi cũ (7 ca): 7/7 PASS, exit 0
- Probe biên & ma trận 8 lỗi Slack contract (12 ca): 12/12 PASS, exit 0
- Targeted Vitest (github-digest-runner, github-adapter, validator, github-planning, github-digest-proposal): 5 files / 65 tests PASS, exit 0
- Full check (CI=true VITEST_MAX_WORKERS=2 npm run check): PASS, exit 0
  - v3: 3.864 PASS (347 schemas + 469 adapters + 405 planner + 43 executor + 1.610 API + 990 web)
  - eval fixtures: 406 PASS
  - Node/launcher: 99 PASS
  - typecheck/build/bundle-security: PASS
- Playwright Browser E2E (github-oauth-and-digest.spec.ts + đối chiếu DB PostgreSQL):
  - Desktop Chromium: 2/2 PASS (28.6s), exit 0
  - Mobile Chromium 390×844: 2/2 PASS (23.4s), exit 0
- Cây kết hợp sau merge 0661b759 (gồm Jira #255/#257/#258 + GitHub #260):
  - npm run typecheck:v3: PASS, exit 0
```

## Handoff và giới hạn

- Cập nhật `CURRENT-STATE.md` và `ROADMAP.md` sau khi merge #260.
- OAuth GitHub/Telegram thật, provider Slack/Telegram/GitHub thật và model/golden set thật vẫn ở trạng thái **NOT_RUN**. Không tự động bật flags hay chạy migration trên DB production.
