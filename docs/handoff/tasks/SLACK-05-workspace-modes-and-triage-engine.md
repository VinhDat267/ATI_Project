# SLACK-05 · Ba Chế độ Đánh giá, Ranh giới Liên quan và Động cơ Phân loại

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Nhóm trưởng duyệt; chưa thực thi code).
**Nhánh dự kiến:** `feat/slack-05-workspace-modes-and-triage-engine`.
**Nền đối chiếu:** `fc12e3fb` (sau merge SLACK-01 #183).
**Phụ thuộc:**
- **SLACK-01** (Policy pure contract `decideSlackModelUse`) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02 (Đối chiếu Ứng viên PR 184):** PR 184 chưa có bảng chấp thuận tổ chức F1 `slack_consent_records`; card này yêu cầu cổng chấp thuận F1 phải được định nghĩa và nạp dữ liệu trước khi cho phép AI Triage Worker hoạt động.
- **SLACK-03** (Source store và tool adapters) — Yêu cầu `SlackSourceStore` và các công cụ đọc.
- **SLACK-04** (Queue jobs và fanout) — Nhận `slack_triage_jobs` từ ingress.
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 3, 4.4, 6, 10).
**Kế hoạch chi tiết:** [Slack Remaining Delivery Plan](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này xây dựng động cơ phân loại tin nhắn (Triage Engine) với ba chế độ hoạt động độc lập cho từng cặp `(ATI user, connection)`: **Luật**, **AI**, và **Kết hợp (Hybrid)**. Động cơ tuân thủ nghiêm ngặt ranh giới liên quan cá nhân do chủ dự án phê duyệt, quản lý phiên bản cấu hình theo CAS (`configVersion`), kiểm soát ngân sách hữu hạn, hàng đợi quá tải, và đảm bảo điều kiện F1 trước mọi lời gọi mô hình.

### Ranh giới nghiệp vụ cốt lõi:
1. **Ranh giới liên quan cá nhân (Strict Relevance Boundary):**
   - Quyền truy cập rộng vào mọi kênh KHÔNG đồng nghĩa với việc gom mọi việc chung của người khác thành việc của mình.
   - Hệ thống CHỈ tạo đề xuất công việc khi có bằng chứng liên quan trực tiếp đến người kết nối:
     - Được mention rõ ràng (`<@U_SLACK_USER>`).
     - Được giao việc trực tiếp trong tin nhắn hoặc DM 1:1.
     - Tự nhận việc ("tôi sẽ làm việc này...").
     - Nằm trong thread mà người dùng chủ động bấm theo dõi trong ATI (`followed_threads`).
   - Các tin nhắn thông báo chung (`@here`, `@channel`), thảo luận không có chỉ định, hoặc lỗi chung trong kênh trả về `no_action` (kể cả ở Mode AI).
2. **Ba chế độ cấu hình riêng biệt:**
   - **Chế độ Luật (Rule Mode):** Khớp từ khóa, tác giả, loại hội thoại; khớp -> sinh intent/template; không khớp -> `no_action` (0 token chi phí LLM). Nếu intent cần lập plan phức tạp qua model thì vẫn phải qua kiểm tra F1.
   - **Chế độ AI (AI Mode):** Đánh giá mọi tin hợp lệ; trả về `no_action`, yêu cầu làm rõ (`needs_clarification`), hoặc đề xuất công việc kèm lý do và trích dẫn nguồn.
   - **Chế độ Kết hợp (Hybrid Mode - Mặc định):** Bộ lọc luật chọn ứng viên trước để loại bỏ nhiễu; AI phân tích ngữ cảnh sâu cho các tin ứng viên.
3. **F1 Gate trước MỌI lời gọi Model:** Bắt buộc kiểm tra `decideSlackModelUse` (xác minh consent tổ chức còn hiệu lực, provider đã được thẩm định không dùng dữ liệu huấn luyện, trần lưu trữ phù hợp). Áp dụng cho cả Mode AI, Mode Kết hợp, planner của Mode Luật, tra cứu và retry.
4. **Kiểm soát Ngân sách, Quá tải & Hàng đợi:**
   - Cấu hình trần token/lời gọi model theo ngày/tháng. Khi hết ngân sách -> chuyển sang trạng thái `paused_budget_exceeded`; tin nhắn chưa đánh giá được giữ trong hàng đợi (`backlog_held`), KHÔNG được âm thầm chuyển thành `no_action`.
   - Giới hạn hàng đợi tối đa (`maxQueueLength`); quá tải trả về trạng thái `backlog_full` và cảnh báo người dùng.
   - Gom tin cùng thread trong 30 giây (debouncing); ngữ cảnh tối đa 20 tin hoặc 20.000 ký tự (ghi rõ nhãn `context_truncated: true` nếu bị cắt).
5. **CAS Configuration Versioning:** Thay đổi cấu hình làm tăng `config_version`. Worker đang xử lý dở phải đối chiếu `config_version` trước khi xuất bản đề xuất; nếu phiên bản đã đổi -> hủy kết quả và đánh giá lại theo cấu hình mới.

---

## 2. Phân chia Module và Quyền sở hữu (Module Ownership)

- **AI Engineer:** Sở hữu `packages/planner/src/slack/`, `prompts/slack-triage.prompt.txt`, `packages/tool-schemas/src/myslack-config.ts`.
- **Backend Engineer:** Sở hữu `apps/chat-api/src/services/slack/slack-triage-worker.ts`, `apps/chat-api/src/services/slack/slack-rules-engine.ts`, `apps/chat-api/src/services/slack/slack-budget-tracker.ts`, `db/v3/[proposed: NNNN_slack_workspace_configs.sql]`.

---

## 3. Lộ trình Phân rã Bounded PRs

### Giai đoạn 05A: Schema Cấu hình, DB Migrations & Engine Luật (PR 1)
- **Code Owner:** Backend Engineer (`apps/chat-api`, `db/v3`) + AI Engineer (`packages/tool-schemas`)
- **Files:**
  - Create: `packages/tool-schemas/src/myslack-config.ts`
  - Create: `db/v3/[proposed: NNNN_slack_workspace_configs.sql]` (Số thứ tự migration được cấp sau khi chốt backend head)
  - Create: `apps/chat-api/src/services/slack/slack-rules-engine.ts`
  - Tests (proposed): `packages/tool-schemas/tests/myslack-config.test.ts`, `apps/chat-api/tests/slack/slack-rules-engine.test.mjs`
- **Nội dung:**
  - Định nghĩa schema `SlackWorkspaceConfig`: `(atiUserId, connectionId, mode, enabled, configVersion, rules, budget, maxQueueLength, timezone)`.
  - Migration tạo bảng `slack_workspace_configs` và `slack_followed_threads` với khóa ngoại và ràng buộc duy nhất.
  - Xây dựng `SlackRulesEngine`: So khớp siêu dữ liệu tin nhắn thuần túy (mentions, channel types, authors, regex patterns). Kiểm tra tính năng theo dõi thread (`followed_threads`).
  - Unit tests cho Rules Engine chứng minh: tin có mention cá nhân -> trigger intent; tin `@here`/`@channel` không có mention -> `no_action`.

### Giai đoạn 05B: Prompt AI Triage, F1 Enforcement & Budget Tracker (PR 2)
- **Code Owner:** AI Engineer (`packages/planner`, `prompts`) + Backend Engineer (`apps/chat-api`)
- **Files:**
  - Create: `prompts/slack-triage.prompt.txt`
  - Create: `packages/planner/src/slack/slack-triage-planner.ts`
  - Create: `apps/chat-api/src/services/slack/slack-budget-tracker.ts`
  - Modify (verified): `packages/planner/src/planner.ts` (Tích hợp F1 policy check trước khi xử lý tin nhắn)
  - Tests (proposed): `packages/planner/tests/slack/slack-triage-planner.test.ts`, `apps/chat-api/tests/slack/slack-budget-tracker.test.mjs`
- **Nội dung:**
  - Xây dựng prompt phân loại AI: Nhận ngữ cảnh tin nhắn (tối đa 20 tin / 20k ký tự), thông tin người dùng được kết nối; hướng dẫn phân biệt việc liên quan cá nhân vs việc chung; yêu cầu trích dẫn nguồn cụ thể.
  - Cổng F1 Model Policy: Tích hợp `decideSlackModelUse` trước khi gọi provider LLM trong `planner.ts`. Nếu consent thiếu hoặc provider không hợp lệ -> chặn gọi model, trả về lỗi chính sách rõ ràng.
  - `SlackBudgetTracker`: Theo dõi số token và số lượt gọi trong DB PG16; kiểm tra trước khi dispatch job; ngắt và đánh dấu `paused_budget_exceeded` khi chạm trần.

### Giai đoạn 05C: Worker Hợp nhất, CAS & Quản lý Hàng đợi (PR 3)
- **Code Owner:** Backend Engineer (`apps/chat-api`)
- **Files:**
  - Create: `apps/chat-api/src/services/slack/slack-triage-worker.ts`
  - Tests (proposed): `apps/chat-api/tests/slack/slack-triage-worker.test.mjs`
- **Nội dung:**
  - Worker nhặt job từ `slack_triage_jobs` bằng transaction `FOR UPDATE SKIP LOCKED`.
  - Điều phối theo mode:
    - Mode Luật: chạy RulesEngine; nếu khớp và intent yêu cầu plan -> gọi planner (có kiểm tra F1).
    - Mode AI: kiểm tra F1 -> gọi LLM triage -> trích xuất intent & rationale.
    - Mode Kết hợp: RulesEngine lọc ứng viên trước; ứng viên đạt mới chuyển sang AI triage.
  - Xử lý race condition cấu hình (CAS): So sánh `configVersion` lúc bắt đầu và lúc kết thúc job. Nếu có sự chênh lệch -> hủy kết quả, nạp lại cấu hình mới và đánh giá lại.
  - Gom tin nhắn cùng thread trong 30 giây (debouncing window).

---

## 4. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (Ranh giới Liên quan Cá nhân):**
  - Tin nhắn có nội dung: `"@alex làm xong báo cáo chưa?"` (với Alex là user kết nối) -> phân loại thành công việc liên quan.
  - Tin nhắn trong kênh chung: `"@channel hôm nay có ai trực server không?"` -> trả về `no_action`, không tạo đề xuất.
- [ ] **AC2 (F1 Chặn Lời gọi Model Chưa Phê duyệt):** Khi `consent.status = 'revoked'` hoặc provider chưa qua xác minh không huấn luyện:
  - Mode AI và Mode Kết hợp từ chối gọi LLM, ghi nhận trạng thái `CONSENT_REVOKED`.
  - Mode Luật vẫn chạy bộ lọc luật; nếu intent cần gọi planner thì planner bị chặn lại trước khi gửi prompt.
- [ ] **AC3 (CAS Configuration Versioning):** Khi đổi mode từ Hybrid sang Rule trong lúc job AI đang chạy: kết quả AI bị hủy bỏ khi kiểm tra `configVersion`, job được chạy lại theo Mode Luật thuần túy.
- [ ] **AC4 (Bảo toàn Hàng đợi khi Hết Ngân sách):** Khi vượt ngân sách sử dụng, hệ thống chuyển sang `paused_budget_exceeded`; các tin nhắn còn lại trong hàng đợi được giữ nguyên trạng thái chờ, không bị xóa và không bị đánh dấu `no_action`.
- [ ] **AC5 (Cắt ngắn Ngữ cảnh Minh bạch):** Khi thread vượt quá 20 tin hoặc 20.000 ký tự, phần vượt bị cắt và metadata lưu trữ ghi nhận rõ `context_truncated: true`.

---

## 5. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Toàn bộ script và test dưới đây sử dụng PostgreSQL 16 thật và HTTP Fixture thật, không dùng mock boolean. Các lệnh chưa chạy được đánh dấu `[Proposed: not run]`.

1. **Kiểm tra Rules Engine & Ranh giới Liên quan:**
   ```powershell
   # [Proposed: not run] Test cases cho deterministic rules & thread follow:
   # node --test apps/chat-api/tests/slack/slack-rules-engine.test.mjs
   ```
2. **Kiểm tra F1 Gate & Budget Enforcement:**
   ```powershell
   # [Proposed: not run] Test F1 check trong triage planner và budget tracker:
   # node --test packages/planner/tests/slack/slack-triage-planner.test.mjs
   # node --test apps/chat-api/tests/slack/slack-budget-tracker.test.mjs
   ```
3. **Kiểm tra Triage Worker, CAS & Debouncing:**
   ```powershell
   # [Proposed: not run] Test concurrency CAS và thread debouncing với PG16 thật:
   # node --test apps/chat-api/tests/slack/slack-triage-worker.test.mjs
   ```
4. **Kiểm tra Toàn diện Suite:**
   ```powershell
   npm run test:slack:foundation
   npm run typecheck:v3
   npm run check
   ```

---

## 6. Kết quả (Dành cho Agent Thi công)

*(Phần này để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes, test logs và evidence).*
