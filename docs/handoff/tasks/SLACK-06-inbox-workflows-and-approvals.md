# SLACK-06 · Hộp Đề xuất ATI, Workflows Liên Dịch vụ và Cổng Phê duyệt

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Nhóm trưởng duyệt; chưa thực thi code).
**Nhánh dự kiến:** `feat/slack-06-inbox-workflows-and-approvals`.
**Nền đối chiếu:** `fc12e3fb` (sau merge SLACK-01 #183).
**Phụ thuộc:**
- **SLACK-03** (Catalog công cụ, adapter và source store) — ĐÃ HOÀN TẤT.
- **SLACK-04** (Ingress và an toàn thực thi UNKNOWN) — ĐÃ HOÀN TẤT.
- **SLACK-05** (Động cơ phân loại và sinh intent đề xuất) — ĐÃ HOÀN TẤT.
- **Hạ tầng Lịch chạy (SCHED-01–03):** Đã merge vào main (sau cờ `SCHEDULES_ENABLED`).
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 7, 8, 9.1).
**Kế hoạch chi tiết:** [Slack Remaining Delivery Plan](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này xây dựng giao diện Hộp đề xuất (Proposal Inbox) trong ATI, hỗ trợ các quy trình tự động hóa liên dịch vụ (Cross-Service Workflows: Slack → Trello / Jira / Sheets / Phản hồi Slack), thiết lập Bản tổng hợp công việc hàng ngày (Daily Digest) tích hợp với scheduler, và thực thi nghiêm ngặt nguyên tắc **Cổng phê duyệt trước MỌI thao tác ghi (Explicit Approval Before Every Write)**.

### Ranh giới nghiệp vụ cốt lõi:
1. **Duyệt và Thao tác TRONG ATI:** Tuyệt đối không đưa luồng phê duyệt hay nút bấm tương tác ra ngoài Slack; mọi hoạt động xem, chỉnh sửa, từ chối và phê duyệt đều diễn ra trong ứng dụng ATI.
2. **Cấu trúc Hộp đề xuất:**
   - Phân chia rõ ràng theo từng Workspace, hiển thị tên Workspace và danh tính Slack user mà người dùng đang đại diện.
   - Vòng đời trạng thái đề xuất: `pending_review` (chờ xem), `needs_info` (cần bổ sung), `ready` (sẵn sàng), `executing` (đang chạy), `completed` (hoàn tất), `rejected` (từ chối), `expired` (quá hạn 7 ngày), `stale_re_eval` (cần đánh giá lại do nguồn đổi/mất quyền).
   - Nội dung thẻ đề xuất: Deep link & permalink tới tin nhắn gốc, đoạn trích có quyền truy cập, lý do phát hiện (mode & rule/AI justification), các bước hành động dự kiến, đích dịch vụ/tài nguyên, danh tính thực thi, và các thông tin còn thiếu.
3. **Chỉnh sửa và Tái lập Kế hoạch Tương tác:**
   - Người dùng có thể bấm "Chỉnh sửa trong chat" để mở hội thoại ATI có nạp sẵn ngữ cảnh của đề xuất.
   - Mọi thay đổi về nội dung, đích dịch vụ, tài khoản thực thi hoặc tham số đều tạo ra một kế hoạch mới với `planHash` mới và yêu cầu duyệt lại từ đầu; không bao giờ âm thầm sửa đổi kế hoạch đang chạy.
4. **Cổng Phê duyệt Trước MỌI Thao tác Ghi:**
   - Các bước đọc (read) có thể chạy ngầm để thu thập dữ liệu lập plan.
   - MỌI bước ghi (write/update/delete) bắt buộc phải hiển thị preview chi tiết và có sự phê duyệt chủ động (explicit click) của người dùng trước khi dispatch.
5. **Bản Tổng hợp Hàng ngày (Daily Digest):**
   - Tùy chọn theo từng workspace (mặc định tắt; giờ mặc định 09:00 theo timezone).
   - Tích hợp vào hệ thống scheduler hiện có (`schedules` table) thông qua cờ `SCHEDULES_ENABLED`.
   - Invariant: Daily Digest chỉ đọc và tổng hợp danh sách công việc còn mở; scheduler TUYỆT ĐỐI KHÔNG tự động thực thi các hành động ghi ngoài hệ thống mà không có sự phê duyệt của người dùng.
6. **Thực thi F3 trên Giao diện (Immediate UI Redaction):**
   - Khi nguồn bị sửa, xóa ở Slack hoặc kết nối bị thu hồi:
   - Đề xuất đang chờ lập tức chuyển sang `stale_re_eval`.
   - Trích đoạn và nội dung nhạy cảm được che hoặc xóa sạch; xem lại hội thoại cũ không làm lộ dữ liệu nguồn đã bị thu hồi.

---

## 2. Phân chia Module và Quyền sở hữu (Module Ownership)

- **Frontend Engineer:** Sở hữu `apps/chat-web/src/components/slack/SlackProposalInbox.tsx`, `apps/chat-web/src/components/slack/SlackProposalCard.tsx`, `apps/chat-web/src/components/cockpit/`, `apps/chat-web/src/services/proposal-api.ts`.
- **Backend Engineer:** Sở hữu `apps/chat-api/src/routes/slack-proposals.ts`, `apps/chat-api/src/services/slack/slack-proposal-service.ts`, `apps/chat-api/src/services/slack/slack-digest-service.ts`, `db/v3/[proposed: NNNN_slack_proposals.sql]`.
- **AI Engineer:** Sở hữu sửa đổi logic template liên dịch vụ trong `packages/planner/src/planner.ts`.

---

## 3. Lộ trình Phân rã Bounded PRs

### Giai đoạn 06A: API Đề xuất, DB Migration & Proposal Service (PR 1)
- **Code Owner:** Backend Engineer (`apps/chat-api`, `db/v3`)
- **Files:**
  - Create: `db/v3/[proposed: NNNN_slack_proposals.sql]` (Số thứ tự migration được cấp sau reviewed backend head; cho phép stacked branches trước merge)
  - Create: `apps/chat-api/src/routes/slack-proposals.ts`
  - Create: `apps/chat-api/src/services/slack/slack-proposal-service.ts`
  - Tests (proposed): `apps/chat-api/tests/slack/slack-proposals-api.test.mjs`
- **Nội dung:**
  - Migration tạo bảng `slack_proposals` lưu `(id, user_id, connection_id, workspace_id, status, source_ref, intent_action, proposed_steps_json, plan_hash, missing_info_json, expires_at, created_at)`.
  - API Routes:
    - `GET /api/slack/proposals`: Danh sách đề xuất theo connection/workspace, lọc theo trạng thái.
    - `POST /api/slack/proposals/:id/approve`: Duyệt và chuyển sang dispatch executor.
    - `POST /api/slack/proposals/:id/reject`: Đánh dấu từ chối đề xuất.
    - `POST /api/slack/proposals/:id/refine`: Tạo phiên chat mới với proposal context.
  - Phân tách chứng chỉ an toàn: API đề xuất chỉ trả về public DTO metadata và validated `SlackBinding`; tuyệt đối không trả về internal encrypted credential rows hoặc token.
  - Tự động hết hạn: Đề xuất chưa duyệt tự động chuyển sang `expired` sau 7 ngày; trích đoạn lưu trữ rút gọn sau 30 ngày.

### Giai đoạn 06B: Giao diện Hộp Đề xuất trong ATI Cockpit (PR 2)
- **Code Owner:** Frontend Engineer (`apps/chat-web`)
- **Files:**
  - Create: `apps/chat-web/src/components/slack/SlackProposalInbox.tsx`
  - Create: `apps/chat-web/src/components/slack/SlackProposalCard.tsx` (Tệp tương lai được tạo mới trong task này)
  - Modify (verified existing in repo): `apps/chat-web/src/routes.ts`
  - Tests (proposed): `apps/chat-web/tests/slack/SlackProposalInbox.test.tsx`
- **Nội dung:**
  - Giao diện Proposal Inbox đáp ứng chuẩn 1440px desktop và 375px mobile, hỗ trợ cả Light/Dark theme.
  - Bộ lọc theo Workspace và Tabs trạng thái (Chờ xem, Cần bổ sung, Đã duyệt, Lịch sử).
  - Thẻ đề xuất (Card): Hiển thị nhãn workspace, tác giả, deep link, trích dẫn nội dung được bảo vệ bởi ACL, các bước hành động dự kiến, các cảnh báo thông tin còn thiếu.
  - Tích hợp nút "Duyệt ngay", "Chỉnh sửa trong chat", và "Bỏ qua".

### Giai đoạn 06C: Workflows Liên Dịch vụ, Daily Digest & F3 UI Masking (PR 3)
- **Code Owner:** Nhóm phối hợp (Coordination Group) phân rã thành các task con đơn sở hữu (single-owner child cards/PRs, schema/interface trước):
  - 06C.1 (AI Engineer): Cross-service plan templates trong `packages/planner` (Slack intent -> Trello card + Slack reply)
  - 06C.2 (Backend Engineer): Daily Digest service & API trong `apps/chat-api`
  - 06C.3 (Frontend Engineer): F3 UI Masking & Redaction trong `apps/chat-web`
- **Files:**
  - Create: `apps/chat-api/src/services/slack/slack-digest-service.ts`
  - Modify (verified existing in repo): `packages/planner/src/planner.ts` (Thêm mẫu lập plan từ Slack intent sang Trello/Jira/Sheets)
  - Modify (future file created by Giai đoạn 06B): `apps/chat-web/src/components/slack/SlackProposalCard.tsx`
  - Tests (proposed): `apps/chat-api/tests/slack/slack-digest-service.test.mjs`, `apps/chat-web/tests/slack/slack-f3-redaction.test.tsx`
- **Nội dung:**
  - Hỗ trợ các mẫu workflow liên dịch vụ thực tế:
    - Giao việc: Tạo thẻ Trello (`trello.create_card`) + gửi tin phản hồi trong đúng thread Slack kèm permalink Trello (`myslack.chat.postMessage`).
    - Báo lỗi: Đề xuất tạo ticket Jira kèm nguồn trích dẫn.
    - Báo tiến độ: Cập nhật dòng Google Sheets (`mysheets.*`).
  - Bản tổng hợp hàng ngày (`SlackDigestService`): Lập lịch quét lúc 09:00, gom các đề xuất còn mở và câu hỏi chưa trả lời; tạo bản tin tổng hợp hiển thị trong ATI; KHÔNG tự động ghi bất kỳ dữ liệu nào ra ngoài.
  - F3 Masking Test: Khi source bị xóa hoặc connection bị ngắt, thẻ đề xuất trên UI lập tức hiển thị trạng thái `[Nội dung nguồn đã bị xóa/thu hồi]`; mở hội thoại chat cũ xác nhận văn bản trích dẫn đã bị che hoàn toàn.
  - An toàn chứng chỉ: Các luồng liên dịch vụ chỉ nhận validated metadata, việc lấy token do adapter của từng service thực hiện độc lập tại thời điểm thực thi.

---

## 4. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (Hiển thị và Phân chia Workspace Đúng đắn):** Hộp đề xuất tách biệt theo từng workspace; người dùng kết nối 2 workspace thấy 2 danh sách riêng, không bị trộn lẫn hoặc hiển thị nhầm danh tính đại diện.
- [ ] **AC2 (Cổng Duyệt Ghi Bắt buộc):** Bấm "Duyệt ngay" trên đề xuất có bước ghi (ví dụ `trello.create_card` hoặc `myslack.chat.postMessage`) sẽ hiển thị hộp thoại xác nhận chi tiết (preview). Không có bất kỳ lệnh ghi nào được gửi đi nếu người dùng chưa bấm xác nhận.
- [ ] **AC3 (Sửa Đổi Sinh PlanHash Mới):** Khi chuyển sang chat và sửa đổi tham số (ví dụ đổi danh sách Trello từ "Backlog" sang "Doing"), hệ thống tạo một kế hoạch mới với `planHash` mới; kế hoạch cũ không thể thực thi được nữa.
- [ ] **AC4 (Workflow Liên Dịch vụ Chuẩn xác):** Luồng tạo card Trello + phản hồi Slack thực thi thành công cả 2 bước: card Trello được tạo, link card được đưa vào nội dung tin nhắn gửi vào đúng thread Slack ban đầu.
- [ ] **AC5 (Daily Digest An toàn):** Lượt chạy Daily Digest lúc 09:00 tạo bản tin tổng hợp trong ATI; không phát sinh bất kỳ write request nào tới Trello/Jira/Slack nếu người dùng không duyệt.
- [ ] **AC6 (F3 UI Redaction):** Khi xóa tin nhắn nguồn ở Slack hoặc ngắt kết nối trong Settings, thẻ đề xuất chuyển sang `stale_re_eval` và toàn bộ trích dẫn nguồn trên giao diện bị ẩn ngay lập tức.

---

## 5. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Toàn bộ script và test dưới đây sử dụng PostgreSQL 16 thật và HTTP Fixture thật, không dùng mock boolean. Các lệnh chưa chạy được đánh dấu `[Proposed: not run]`.

1. **Kiểm tra API Đề xuất & Vòng đời Status:**
   ```powershell
   # [Proposed: not run] Test CRUD và status transitions của proposals:
   # node --test apps/chat-api/tests/slack/slack-proposals-api.test.mjs
   ```
2. **Kiểm tra Daily Digest & Tích hợp Scheduler:**
   ```powershell
   # [Proposed: not run] Test digest scheduler và no-autonomous-write invariant:
   # node --test apps/chat-api/tests/slack/slack-digest-service.test.mjs
   ```
3. **Kiểm tra Giao diện Web & F3 Redaction (Vitest/Testing Library):**
   ```powershell
   # [Proposed: not run] Frontend component tests cho Inbox và UI masking:
   # npm test -w @wap/chat-web -- tests/slack/SlackProposalInbox.test.tsx
   ```
4. **Kiểm tra Toàn diện Suite:**
   ```powershell
   npm run test:slack:foundation
   npm run typecheck:v3
   npm run check
   ```

---

## 6. Kết quả (Dành cho Agent Thi công)

- **Trạng thái:** Đã hoàn tất thi công `SLACK-06A` & `SLACK-06B` (kèm rà soát và vá lỗi `SLACK-05A` DM relevance) trên nhánh `feat/slack-05-modes` theo đúng kế hoạch M4 [`docs/superpowers/plans/2026-11-01-slack-m4-modes-inbox-digest.md`](../../superpowers/plans/2026-11-01-slack-m4-modes-inbox-digest.md).
- **Chi tiết bàn giao và bằng chứng chạy lệnh:** Xem [`docs/handoff/log/2026-11-02-slack06ab-inbox-digest.md`](../log/2026-11-02-slack06ab-inbox-digest.md).
- **Kết quả kiểm thử thực tế (PostgreSQL 16 cổng `56569`, HTTP fixtures thật, không dùng mock boolean):**
  - `packages/tool-schemas` (`myslack-assistant.test.ts` + `myslack-post-plan.test.ts`): **40/40 PASS**
  - `packages/planner` (`slack-proposal-plan.test.ts` + `slack-triage-planner.test.ts`): **6/6 PASS**
  - `apps/chat-api` (`slack-rules-engine.test.ts` 5/5, `slack-triage-worker.test.ts` 16/16, `slack-assistant.test.ts` 6/6, `slack-proposals.test.ts` 4/4, `slack-digest-service.test.ts` 2/2): **33/33 PASS**
  - `apps/chat-web` (`slack-assistant-settings.test.tsx` 7/7, `slack-proposal-inbox.test.tsx` 2/2): **9/9 PASS**
  - `npm run typecheck:v3`: **PASS (0 errors)**
  - `npx vitest run evaluations --maxWorkers=2` (bao gồm `evaluations/generic-plumbing/static-guard.test.ts`): **25/25 files, 406/406 PASS**
- Không chỉnh sửa `docs/handoff/CURRENT-STATE.md` hoặc `docs/handoff/ROADMAP.md` (thuộc quyền Reviewer sau khi merge).
