# 29/10/2026 · Lập Kế hoạch và Soạn thảo Task Cards SLACK-03–07 (Bản Sửa sau Review)

**Ủy quyền:** Chủ dự án chỉ định Trưởng nhóm điều phối / Reviewer (Coordinator) và Antigravity builder hoàn thiện lộ trình chi tiết bằng tài liệu cho toàn bộ các task Slack còn lại (SLACK-03, 04, 05, 06, 07), khắc phục triệt để 6 nhóm ý kiến thẩm định từ Coordinator.
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Tuyệt đối không sửa mã nguồn sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, `SLACK-01B` hoặc `SLACK-02`. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR.
**Nhánh làm việc:** `VinhDat267/docs-slack-remaining-roadmap` · **Base commit:** `fc12e3fb` (sau merge SLACK-01 #183).

---

## 1. Khắc phục Toàn diện 6 Nhóm Ý kiến Thẩm định (Review Findings Addressed)

### F1. Đối chiếu Ứng viên PR 184 & Giao diện Phụ thuộc Hợp đồng
- **Nhận diện đúng hiện trạng PR 184:** Acknowledge draft PR 184 (`ac448dd39fd8b9188c4ebc967cb735454bbc803d`) hiện có migration `db/v3/0014_slack_oauth_connections.sql` định nghĩa bảng `slack_connections` và `slack_oauth_states`.
- **Không tạo migration trùng lặp:** Tuyệt đối không tạo file thứ hai `0014_...sql`. Các migration tiếp theo từ SLACK-03 trở đi được đánh số đề xuất `[proposed: NNNN_...sql]` và sẽ được cấp số thứ tự chính thức sau khi backend head được phê duyệt và merge.
- **Minh bạch tình trạng thẩm định PR 184:** Ghi nhận trung thực rằng PR 184 CHƯA ĐẠT REVIEW do phát hiện lỗi tái hiện trên PostgreSQL thật (hai OAuth state hợp lệ cùng session ATI nhưng khác workspace bị lệnh DELETE toàn cục xóa mất 1 state), đồng thời PR 184 vẫn chưa có bảng chấp thuận tổ chức F1 `slack_consent_records`.
- **Chuẩn hóa Hợp đồng Yêu cầu (Prerequisite Requirements):**
  - Chữ ký tra cứu bắt buộc có kiểm tra quyền sở hữu của caller (caller ownership): `getConnectionForUser(atiUserId, connectionId, expectedIdentityVersion)`. Tuyệt đối không dùng hàm không an toàn `getConnection(id)`.
  - Tuyệt đối không truyền token mã hóa (`tokenEncrypted`, `config`) vào planner hoặc shared public DTO. DTO công khai / lập kế hoạch chỉ mang `SlackBinding` và metadata sức khỏe kết nối.

### F2. Đối chiếu Toàn diện Danh mục 354 Methods (PR 185 Inventory Reconciliation)
- Cập nhật số liệu kiểm kê theo snapshot mới nhất PR 185 (head `811f5dc9`):
  - Tổng số: **354 phương thức** canonical.
  - **101 phương thức loại trừ (`excluded`):** 96 method Enterprise-only (bao gồm 4 method `admin.slackbot.skills.*`), 3 method deprecated/retired (`files.upload`, `rtm.start`, `users.setActive`), 2 method app-level token.
  - **253 phương thức cần probe (`probe_required`):** Bổ sung 7 method người dùng mới `slackbot.skills.*` (yêu cầu probe Free/Pro và Canvas dependency).
  - **265 phương thức có user scopes; 89 phương thức chưa xác định token eligibility.**
  - **Toàn bộ 354 method hiện có trạng thái `deliveryStatus: not_implemented`.**
- Ở task 03E, xây dựng sổ cái đối soát rõ ràng cho từng nhóm phương thức: `conversations` (28 total), `chat` (13), `users` (13 total), `search` (3), `files` (14 total), `pins` (3), `reactions` (4), `bookmarks` (4), `reminders` (5), `stars` (3), `dnd` (5), `canvases` (7), `slackLists` (12), `skills` (7), `team` (7), `usergroups` (7), `apps` (21), `assistant` (5), `agents` (11), `admin` (36), `calls` (6), `functions` (8), `workflows` (8), `views` (4), `blocks` (1), `bots` (1), `dialog` (1), `emoji` (1), `entity` (3), `migration` (1), `rtm` (1), `tooling` (1), `auth` (2), `api` (1).
- Tuyệt đối không để nhóm nào biến mất hoặc gộp vào generic dispatcher `method + args`.

### F3. Loại bỏ Giả định Sai về Entitlement & Xác minh Nguồn Cấp 1
- **Xóa bỏ khẳng định sai về `search.*`:** Theo tài liệu chính thức của Slack, `search.*` yêu cầu scope `search:read`; điều kiện gói dịch vụ (plan requirement) ghi rõ: *"Not established by metadata; native plan probe required"*. Do đó, `search.*` KHÔNG được mặc định gán là "yêu cầu gói Pro", mà phải giữ đúng trạng thái `probe_required`.
- Xác minh số lượng phương thức chính xác từ metadata: `conversations` có 28 methods (27 standard + 1 canvas op), `chat` có 13 methods, `users` có 13 methods (12 candidate/probe + 1 deprecated `setActive`).
- Ghi rõ: Metadata và HTTP fixture không phải là bằng chứng nghiệm thu Free/Pro; không hứa hẹn tính khả dụng phổ quát khi chưa có kết quả probe native.

### F4. Chuẩn hóa Phân chia Module & Xác minh Tệp Mã nguồn Tồn tại
- Mỗi sub-task/PR chỉ có đúng MỘT vai trò sở hữu mã nguồn:
  - AI / Schema: `packages/tool-schemas/`, `packages/planner/`, `prompts/`, `evaluations/`
  - Integration / Adapter: `packages/tool-adapters/`
  - Backend: `apps/chat-api/`, `packages/executor/`, `db/v3/`
  - Frontend: `apps/chat-web/`
- Loại bỏ các đường dẫn tệp không tồn tại trong codebase:
  - Thay thế `packages/executor/src/step-executor.ts` (không tồn tại) bằng các tệp thực tế đã được xác minh: `packages/executor/src/runner.ts` và `packages/executor/src/controller.ts`.
  - Thay thế `packages/planner/src/workflow-planner.ts` (không tồn tại) bằng `packages/planner/src/planner.ts`.
- Gắn nhãn chuẩn xác: Tệp mới đánh dấu `Create:`, tệp hiện hữu đánh dấu `Modify (verified):`. Toàn bộ lệnh kiểm tra tương lai gắn nhãn `[Proposed: not run]`.

### F5. Bảo toàn Bất biến Cốt lõi & Khắc phục Bước Ingress 04A
- Giữ vững 4 bất biến F1–F4:
  - F1: Chặn mọi dữ liệu nguồn vào model nếu thiếu consent tổ chức hoặc provider chưa xác minh.
  - F2: Bảo toàn binding bất biến từ lookup -> gather -> memory -> preview -> execution.
  - F3: Tombstone tức thì và cascade purge toàn bộ các bản sao nguồn (chat messages, plan args, memory snapshots, schedules).
  - F4: Vòng đời nguồn và purge hoạt động độc lập với cờ tính năng.
- **Khắc phục then chốt cho Bước 04A:**
  - TUYỆT ĐỐI KHÔNG gửi ACK 200 cho các sự kiện yêu cầu xử lý công việc TRƯỚC KHI receipt và queue job đã commit bền vững vào DB.
  - Nếu DB lỗi -> trả 500/503 để Slack retry.
  - Khi cờ automation tắt hoặc workspace pause: Ký số hợp lệ -> ACK 200 và discard body trong memory (không ghi body vào DB); nhưng các sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) vẫn được ghi nhận và purge đầy đủ.
- Giao thức ghi an toàn (Outbox ledger, Echo guard, UNKNOWN guard) bắt buộc phải được thẩm định độc lập trước khi mở bất kỳ tool ghi nào.

### F6. Kiểm tra Toàn vẹn Diff, Bàn giao và Mở Draft PR
- Chạy `git diff --check fc12e3fb HEAD`: Đạt 100%, exit code 0, không có trailing whitespace hay lỗi CRLF/LF.
- Mở Draft PR trên GitHub với nhãn `awaiting-review` theo đúng biểu mẫu `.github/pull_request_template.md`.

---

## 2. Kết quả Tự Kiểm tra (Self-Review & Verification)

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Cú pháp Whitespace / Diff | `git diff --check fc12e3fb HEAD` | Clean, exit code 0 |
| Trạng thái Working Tree | `git status --porcelain` | Sạch sẽ, không có file thừa |
| Ranh giới Module | `git diff --name-only fc12e3fb HEAD` | 100% thuộc `docs/` |
| Bảo vệ Mã nguồn & Trạng thái | Kiểm tra `apps/`, `packages/`, `CURRENT-STATE.md`, `ROADMAP.md` | Không có bất kỳ thay đổi nào |

---

## 3. Bàn giao và Bước tiếp theo

1. Toàn bộ 7 tài liệu kế hoạch đã được cập nhật và commit tại nhánh `VinhDat267/docs-slack-remaining-roadmap`.
2. Đã push nhánh lên remote origin và mở Draft PR với đầy đủ nội dung theo mẫu quy định.
3. Gửi thông báo `worker_done` về điều phối viên với Task ID `task_3e5438e47132` và Dispatch ID `ctx_236f2b5d0bf8`, sau đó chuyển sang trạng thái chờ chỉ đạo tiếp theo.
