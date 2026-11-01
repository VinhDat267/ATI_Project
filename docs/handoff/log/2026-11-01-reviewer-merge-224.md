# 01/11/2026 · Merge #224 (Trello OAuth cá nhân)

**Yêu cầu:** nhóm trưởng yêu cầu merge sau khi review lại Đạt và CI xanh đúng head.
**PR:** [#224](https://github.com/VinhDat267/ATI_Project/pull/224).

## Review và bằng chứng trước merge

- Head được chốt: `84c0693e1d63405eaaf82f1118bcf54f3fd982df`. Base trước merge: `fc12e3fb`. PR CLEAN/MERGEABLE.
- Review mã 11 task đạt trên nhánh, ghi ở [log reviewer](2026-11-01-reviewer-trello-oauth.md). Review độc lập tại `9ccef950` chưa đạt: 2 P1 và 4 P2.
- Sáu commit sửa: `83bf5143`, `73c62710`, `83bb12c5`, `1262628c`, `1ca1d158`, `472ba708`. CI của `472ba708` đỏ vì `resource-labels.integration.test.ts` còn kỳ vọng plan không có `boardId`. Sửa fixture ở `84c0693e`.
- Reviewer chạy lại, không lấy từ báo cáo thi công: `node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/integration/resource-labels.integration.test.ts` — exit 0, 1 test, 4.51s.
- [CI #41281533497](https://github.com/VinhDat267/ATI_Project/actions/runs/41281533497) SUCCESS đúng `84c0693e` (06:36:50Z–06:50:01Z). Job `v3` gồm `npm run check` và `npm run test:browser:v3`.
- Kết luận review lại: **Đạt**. OAuth Trello thật và model live vẫn NOT_RUN.

## Merge thực tế

- Lệnh khóa theo SHA head: `gh pr merge 224 --merge --match-head-commit 84c0693e1d63405eaaf82f1118bcf54f3fd982df`.
- GitHub báo **MERGED**, lúc `2026-11-01T07:04:18Z` (14:04 Asia/Saigon).
- Merge commit: `82376969d8b39297d0bebb6bbf47dac1075c6489`.
- `git diff --exit-code 84c0693e origin/main` ngay sau fetch: exit 0. Cây merge trùng cây head đã qua CI.
- Bàn giao được cập nhật sau merge, chỉ `CURRENT-STATE.md`, `ROADMAP.md` và file log này. Không sửa mã sản phẩm. Không sửa log review mã đã có trong PR.

## Phạm vi đã chốt và việc còn mở

**Phần mã Trello OAuth cá nhân đã vào `main`.** Ô dán API key và token dùng chung đã bỏ. Chín tool `trello.*` giữ nguyên. Quản trị chọn một workspace và từ 1 đến 10 bảng. Thành viên không chọn bảng. Lệnh ghi vẫn chờ duyệt `plan_hash`. Không có cờ tắt, không webhook, không luật tự chạy. Migration `0014_trello_oauth.sql`.

Chưa có ứng dụng Atlassian trên máy chủ demo. Việc tiếp theo của nhóm trưởng: tạo client, một quản trị chọn workspace và bảng, từng thành viên bấm "Kết nối Trello".

Giới hạn không chặn merge: dòng Settings vẫn ghi "/ 8 dịch vụ"; `GET /api/services` vẫn gắn Trello kiểu `shared` với `configured: false`; `CredentialRepo` trong `server.ts` vẫn không nhận `env.ENCRYPTION_KEY`.
