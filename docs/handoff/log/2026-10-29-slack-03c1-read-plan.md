# 29/10/2026 · Lập Kế Hoạch Bounded Read Adapters SLACK-03C1 (8 Phương Thức Cốt Lõi)

**Ngày lập:** 29/10/2026 (Asia/Saigon)
**Tác giả:** Antigravity (Gemini 3.8 Flash High) · Integration Planning Owner
**Ủy quyền:** Coordinator điều phối và giao nhiệm vụ lập kế hoạch tài liệu (Docs-only) cho phân đoạn SLACK-03C1.
**Nhánh làm việc:** `docs/slack-03c1-read-plan`
**Base commit:** `7c6c65d8` (`integration/slack-personal-20261029`, chứa 02B `4e038967` và 02C `8ed24c1b` đã qua review và joint check).
**PR Đích:** Draft PR to `integration/slack-personal-20261029`.
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (DOCS-ONLY)**. Sở hữu đúng 3 tài liệu mới; không sửa code sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, `method-inventory.json`, lockfiles hay bất kỳ card task nào khác. Không gọi native Slack API, không gọi model AI, không gửi tin nhắn hay merge vào `main`.

---

## 1. Tóm Tắt Kế Hoạch & Đối Soát Nghiệp Vụ (Executive Summary)

1. **Phạm vi 8 Phương Thức Đọc Cốt Lõi Ban Đầu (Initial 8 Read Methods Only):**
   - Kế hoạch tập trung duy nhất vào 8 phương thức đọc:
     1. `conversations.list` (GET, tier t2, scopes: `channels:read, groups:read, im:read, mpim:read`)
     2. `conversations.info` (GET, tier t3, scopes: `channels:read, groups:read, im:read, mpim:read`)
     3. `conversations.history` (GET, tier t3, scopes: `channels:history, groups:history, im:history, mpim:history`)
     4. `conversations.replies` (GET, tier t3, scopes: `channels:history, groups:history, im:history, mpim:history`)
     5. `conversations.members` (GET, tier t4, scopes: `channels:read, groups:read, im:read, mpim:read`)
     6. `users.list` (GET, tier t2, scopes: `users:read`)
     7. `users.info` (GET, tier t4, scopes: `users:read`)
     8. `chat.getPermalink` (GET, tier t5, userScopes: `null`, userToken: `undetermined`)
   - Toàn bộ 8 phương thức được đối soát khớp 100% với `docs/slack/method-inventory.json` (SHA256: `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`).
   - Giữ nguyên trạng thái `disposition: probe_required` và `deliveryStatus: not_implemented` cho toàn bộ 8 phương thức; schema và test fixture cục bộ không phải bằng chứng chấp thuận native của Free/Pro.
   - Các phương thức còn lại của nhóm cốt lõi (`conversations` còn 22, `chat` còn 12, `users` còn 10) tiếp tục là backlog mở trong SLACK-03C2 (write tools), 03D và 03E; không bị bỏ sót.
   - Cấm generic dispatcher `myslack.call(method, args)`. Không triển khai hoặc dispatch write tools khi SLACK-04C Outbox / UNKNOWN guard chưa được nghiệm thu.

2. **Ranh Giới Sở Hữu Module & Injected Hooks (Module Ownership & Inversion of Control):**
   - Phạm vi Integration quản lý `packages/tool-schemas/` và `packages/tool-adapters/`.
   - Tuyệt đối không import mã nguồn từ `apps/chat-api/` vào `packages/` và không sửa tệp Backend.
   - Triển khai Injected Hooks qua `PersonalSlackAdapterConfig`:
     - `SlackTokenProviderHook`: Lấy access token an toàn theo `SlackBinding`.
     - `SlackPolicyValidationHook`: Kiểm tra F1 model policy và trạng thái kết nối active từ DB.
   - Token chỉ tồn tại trong bộ nhớ adapter khi gửi request; không xuất hiện trong schemas, DTOs, logs, hoặc kết quả trả về.

3. **Cơ Chế Kiểm Thực Hai Pha F1 & Bảo Vệ Race Condition:**
   - *Pha 1 (Pre-transport):* Xác thực đầy đủ 5 trường `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`) và resolve policy cho mục đích đọc (`purpose: 'conversation_read'`, `requestedRetentionDays: 0`). Nếu kết nối inactive/revoked hoặc thiếu consent -> Ném `AUTH_ERROR` trước khi mở kết nối mạng.
   - *Pha 2 (Post-transport Revalidation):* Sau khi nhận kết quả từ Slack provider, kiểm tra lại trạng thái kết nối từ DB. Nếu user đã ngắt kết nối, bump identity version hoặc thu hồi consent trong lúc chờ await -> Lập tức drop payload, xóa sạch bộ nhớ và ném `AUTH_ERROR`.

4. **Transient Reads (Retention 0) & Native ACL:**
   - Dữ liệu đọc ở 03C1 có retention 0 ngày, không ghi vào `SlackSourceStore` (03B) và không tạo `SlackSourceEntity` bền vững.
   - Tuân thủ native Slack ACL: Kênh public/private, DM, groupDM được kiểm soát theo token/membership thực tế của caller; không dùng channel allowlist tĩnh.
   - Revision nguồn xác định chính xác từ `edited.ts` (nếu có) hoặc `ts` ban đầu; text trần được coi là untrusted provider data.

5. **Giới Hạn Bounded & An Toàn Vận Hành:**
   - Endpoint cố định, không nhận URL từ caller; cấu hình `redirect: 'manual'` chống rò rỉ Bearer token.
   - Giới hạn body response 2MB, hỗ trợ `AbortSignal` hủy kết nối thực tế.
   - Bounded cursor pagination: budget mặc định 20–50, tối đa 100 items/trang.
   - Xử lý HTTP 429 và `Retry-After`: retry tối đa 2 lần cho lỗi mạng quá cảnh, không retry mù.
   - Độc lập hoàn toàn với `ALL_TOOLS` và `SERVICE_REGISTRY`; không rò rỉ tool khi cờ tắt.

---

## 2. Danh Mục Tài Liệu Được Tạo Mới

1. [`docs/handoff/tasks/SLACK-03C1-core-read-adapters.md`](../tasks/SLACK-03C1-core-read-adapters.md): Task card chi tiết cho SLACK-03C1 (8 read methods, injected hooks, 5-field binding, two-phase F1, native ACL, ma trận kiểm thử hành vi).
2. [`docs/superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md`](../../superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md): Bản kế hoạch triển khai tinh gọn (179 dòng, <= 350 dòng), định nghĩa rõ files, interfaces, 4 tasks TDD và ma trận kiểm thử 12 kịch bản.
3. [`docs/handoff/log/2026-10-29-slack-03c1-read-plan.md`](2026-10-29-slack-03c1-read-plan.md): File log bàn giao này.

---

## 3. Bằng Chứng Tự Kiểm Tra & Cổng Nghiệm Thu (Self-Verification Evidence)

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế | Trạng thái |
|---|---|---|---|
| Whitespace & Diff Cú Pháp | `git diff --check 7c6c65d8..HEAD` | Không có lỗi whitespace, exit code 0 | **PASS** |
| Trạng Thái Working Tree | `git status --porcelain` | Đúng 3 tệp tài liệu mới thuộc `docs/` | **PASS** |
| Bảo Vệ Mã Nguồn & Baseline | Kiểm tra `apps/`, `packages/`, `CURRENT-STATE.md`, `ROADMAP.md` | Không có tệp nào ngoài 3 docs bị sửa đổi | **PASS** |
| Dung Lượng Kế Hoạch | Đếm dòng `2026-10-29-slack-03c1-core-read-adapters.md` | **179 dòng** (tiêu chuẩn: <= 350 dòng) | **PASS** |
| Đối Soát 8 Methods | Kiểm tra với `method-inventory.json` hash `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09` | Khớp 100% 8 methods, giữ nguyên `probe_required` | **PASS** |
| Kiểm Thử Sản Phẩm / Native | Vitest test suites, live API calls | Được ghi nhận rõ là **NOT_RUN** trong phiên lập kế hoạch | **PASS** |

---

## 4. Bàn Giao & Bước Tiếp Theo

1. Thực hiện commit đúng 3 tệp tài liệu mới trên nhánh cô lập `docs/slack-03c1-read-plan`.
2. Push nhánh lên remote và mở Draft PR tới nhánh `integration/slack-personal-20261029`.
3. Kiểm tra hòm thư điều phối qua `orca orchestration check`.
4. Gửi báo cáo hoàn tất qua `orca orchestration send --type worker_done` và chuyển sang trạng thái nhàn rỗi (idle), chờ Coordinator thẩm định.
