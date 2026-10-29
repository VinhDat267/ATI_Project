# 30/10/2026 · Lập kế hoạch binding executor & phê duyệt Slack (SLACK-03B3)

**Nhánh:** `docs/slack-03b3-executor-binding-plan` · **Nền:** `59f1aafcebfbcfd8cc727e6c52e9e2f3aae725e3` (= `origin/integration/slack-personal-20261029` lúc bắt đầu) · **Trạng thái:** PLAN_ONLY, chờ review độc lập.

## Đã làm

Tạo đúng 3 tài liệu mới, không sửa mã nguồn hay tài liệu khác:
1. Task card [`SLACK-03B3-executor-binding-and-approval.md`](../tasks/SLACK-03B3-executor-binding-and-approval.md).
2. Kế hoạch [`2026-10-30-slack-03b3-executor-binding-and-approval.md`](../../superpowers/plans/2026-10-30-slack-03b3-executor-binding-and-approval.md) — 266 dòng.
3. Nhật ký này.

## Căn cứ đã đọc

- `docs/handoff/CURRENT-STATE.md`, `README.md`, 3 log mới nhất, `docs/team-workflow.md`, `REVIEW-CHECKLIST.md`, quyết định nguồn `e9088d5e`, đặc tả Slack cá nhân `2026-10-28`, kế hoạch tổng `2026-10-29-slack-remaining-delivery.md`, card 03A/04A, kế hoạch 03B2 (chỉ PLAN).
- Mã hiện hữu tại integration head: `packages/executor/src/{runner,controller,resolver,types}.ts`, test `gmail-pre-dispatch.test.ts`; `packages/tool-schemas/src/{types,myslack-context,myslack-connection,myslack-tools}.ts`; `apps/chat-api/src/services/{chat-service,execution-service,execution-recovery,adapter-factory}.ts`, `db/repositories/{plan-repo,step-repo}.ts`, `config/slack-env.ts`.
- Read-only: 03C1 `390b1c54` (8 phương thức đọc, `args.binding`, hook token/policy, DTO provenance), 03B1 `a38267d1` (`checkBarriers`, cây làm việc còn dở).

## Quyết định chính

- Binding 5 trường nằm trong `PlanConnections.myslack` do Backend gắn trước `sha256(JSON.stringify(response))`, nên được `plan_hash` hiện hữu bảo vệ; không đổi công thức hash.
- Thêm digest thực thi `slack-exec-v1` canonical cho envelope đã phân giải + revision quan sát; tách approval envelope (selector `$ref`) khỏi output late-bound; revision/consent băm nguyên văn chuỗi.
- Classification tĩnh: 8 read của 03C1, write tường minh, mọi tên `myslack.*` khác fail closed; `isWriteTool` không dùng regex cho tiền tố `myslack.`.
- Guard chạy trước `getAdapter`, gọi hook `SlackDispatchGuard` (ATI user/connection/F1/barrier/AbortSignal); thiếu hook/snapshot/adapter ⇒ `requestSent:false`, không tạo UNKNOWN.
- Mọi write Slack bị chặn trước transport tới 04C; không thêm vào `ALL_TOOLS`/`SERVICE_REGISTRY`, không nới 253 `probe_required`.
- `PlanConnections.myslack` là hợp đồng chia sẻ cần Backend + Integration/Schema đồng ý trước khi code; không migration.

## Kiểm chứng đã chạy thật

- Kiểm tra liên kết nội bộ bằng Node (resolve tương đối từ thư mục chứa file, bỏ qua http/`#`/absolute): `checked=7 missing=0`.
- UTF-8: cả 3 file đọc/ghi lại bằng Node `utf8` không lỗi, `file` báo UTF-8.
- Số dòng kế hoạch: `wc -l` = 266 (≤ 300).
- `git diff --check` trên đúng 3 file đã stage: sạch (exit 0).

## Chưa làm / không tuyên bố

- Không chạy bất kỳ test runtime nào (`NOT_RUN` toàn bộ) vì task chỉ tạo tài liệu; không có "all tests passed".
- Chưa nghiệm thu 03B4 (wrapper token/policy + routing), 03B2 (lineage F3), 04C (outbox/UNKNOWN/write), native Slack API, hay 03B1 bản cuối.
- Không cập nhật `CURRENT-STATE.md`/`ROADMAP.md`; reviewer làm sau khi merge.
- Draft PR mở tới `integration/slack-personal-20261029` sau commit này; không merge trong phiên.
