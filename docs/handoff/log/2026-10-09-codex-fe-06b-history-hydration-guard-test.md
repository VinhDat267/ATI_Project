# FE-06B · test chốt giữ kế hoạch mới khi tải lịch sử

- Ngày: 09/10/2026. Task: [FE-06](../tasks/FE-06-cockpit-recovery-and-responses.md), chỉ P3 thứ nhất của [review #116](https://github.com/VinhDat267/ATI_Project/pull/116#issuecomment-6065918028).
- Nhánh: `test/fe-06b-history-hydration-guard`; base `55b4a5883df6ed455c8542d064a50f1483b9192f`.
- Worktree riêng: `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-06b-history-guard-test`. Giữ các thay đổi của người dùng ở main và bằng chứng FE-06B cũ.

## Thay đổi

Thêm một ca vào `apps/chat-web/tests/fe-06b-responses.test.tsx`, dựa trên probe của reviewer. Deferred Promise giữ API history chưa trả; gọi thật `loadConversationHistory` và `handleSSEEvent` với `plan_preview` của `p-new`, rồi trả history kết thúc bằng refusal cũ. Assertion xác nhận refusal vẫn được nạp, kế hoạch mới giữ id/summary/steps/args và trạng thái `preview`.

Chỉ mock ranh giới API; không mock store, bộ nạp history hoặc xử lý SSE. Không dùng sleep/timer để tạo thứ tự race. Không sửa code sản phẩm.

## Kiểm chứng RED → GREEN

Sau khi viết test, tạm bỏ riêng `hydrateResponse &&` khỏi điều kiện trong `use-conversation-history.ts`, chạy:

```text
npm test -w @wap/chat-web -- tests/fe-06b-responses.test.tsx -t "keeps a newer SSE plan preview"
Tests 1 failed | 23 skipped (24), exit 1
AssertionError: expected null to match object { id: 'p-new', … }
```

Khôi phục file sản phẩm trong `finally`, nguyên byte. SHA256 trước/sau: `13F81A844ADAE57BC2AA3DE2B2134C0ED7B9EA346FEB35DF95F5695E10D06F55`; `git diff --exit-code -- apps/chat-web/src/hooks/use-conversation-history.ts` exit 0.

| Lệnh sau khôi phục | Output thật | Exit |
| --- | --- | --- |
| `npm test -w @wap/chat-web -- tests/fe-06b-responses.test.tsx` | 1 file, 24/24 passed | 0 |
| `npm test -w @wap/chat-web` | 56 files, 594/594 passed | 0 |
| `npm run test:eval:v3` | 14 files, 165/165 passed | 0 |
| `npm run typecheck:v3` | API + frontend typecheck, không lỗi | 0 |
| `git diff --check` | Không lỗi khoảng trắng | 0 |

Output local giữ trong `node_modules/.cache/fe06b-history-guard/`, không commit. CI `v3 check` chạy `npm run check` và `npm run test:browser:v3` trên head PR; kết quả cần kiểm trực tiếp trước bàn giao.

## Giới hạn bàn giao

Local chưa chạy lại backend/PostgreSQL, browser, visual hoặc provider live cho thay đổi chỉ thêm test này. Chờ CI đúng head và reviewer repository; chưa merge. Ba P3 còn lại của #116 không thuộc PR này. Không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md`.
