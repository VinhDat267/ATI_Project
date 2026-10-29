# 29/10/2026 · Hoạch Định SLACK-03A: Hợp Đồng Nguồn, ACL, Vòng Đời & Siêu Dữ Liệu Công Cụ (Hiệu Chỉnh Review)

**Tác giả:** Integration / Schema Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng (Coordinator) chỉ định Antigravity builder hoàn thiện kế hoạch chi tiết và task card cho **SLACK-03A** (Hợp đồng vòng đời nguồn, ACL, cascade purge và siêu dữ liệu công cụ theo phương thức).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**.
**Nhánh công việc:** `VinhDat267/docs-slack-03a-source` (phân nhánh từ `integration/slack-personal-20261029` tại `b757ae0`).
**Task card cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](../tasks/SLACK-03-tool-catalog-and-source-lifecycle.md).
**Task card bounded:** [`docs/handoff/tasks/SLACK-03A-source-contracts.md`](../tasks/SLACK-03A-source-contracts.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`](../../superpowers/plans/2026-10-29-slack-03a-source-contracts.md).
**Sổ cái kiểm kê 354 methods:** [`docs/superpowers/plans/slack-354-method-ledger.json`](../../superpowers/plans/slack-354-method-ledger.json).

---

## 1. Khắc Phục Triệt Để 5 Yêu Cầu Hiệu Chỉnh Từ Reviewer

Phiên làm việc này đã hiệu chỉnh toàn diện 4 tài liệu của PR #194 nhằm đáp ứng 100% 5 yêu cầu review độc lập từ Coordinator:

### 1. Phân định 5 Tagged Purge Scopes & Mục tiêu Tinh gọn:
- **Tách `retention_expired` khỏi `resource_lifecycle`:** Hết hạn lưu trữ là thuộc tính riêng của từng chủ kết nối và chính sách (`owner_retention`), không thể dùng scope toàn cục của workspace. Tagged scope `owner_retention` bắt buộc mang đầy đủ `binding: SlackBinding`, `resourceType`, `resourceId`, `revision?` và `policyRef: SlackPolicyReference`.
- **Giới hạn phạm vi `channel_membership_lost`:** Chỉ nhắm vào đúng `channelId` mà kết nối đó bị mất quyền, tuyệt đối không xoá nhầm các kênh khác của cùng kết nối.
- **Bảo toàn `authorization_disconnect`:** Mang đầy đủ `binding: SlackBinding`, chỉ xoá bản sao của riêng connection ngắt kết nối, không làm tổn hại người dùng B trong cùng workspace.

### 2. Khớp Chính Xác Thu Hồi Chấp Thuận Tổ Chức (`workspace_consent_revocation`):
- Tagged scope `workspace_consent_revocation` bắt buộc bao gồm cả 4 trường: `{ workspaceId, policyVersion, providerProfileId, consentRevision }`.
- Purge runner chỉ xoá các bản sao mang đúng `consentRevision` bị thu hồi; nếu tổ chức cấp lại consent (regrant) với một `consentRevision` mới hơn, job thu hồi cũ không được xoá các bản sao mới.

### 3. Lưu Giữ `policyRef` trong Nguồn & Mở Rộng `myslack-policy.ts`:
- `SlackSourceEntity` và mỗi bản sao phái sinh (`SlackDerivedCopyRef`) bắt buộc lưu giữ `policyRef: SlackPolicyReference` đã uỷ quyền lưu trữ.
- Không tạo engine chính sách thứ hai độc lập gây phân mảnh; mở rộng trực tiếp `myslack-policy.ts` với hàm `decideSlackSourceStorage(policy, request)`, kiểm tra `sameSlackBinding(request.binding, request.policyRef.binding)`, kiểm tra `purpose === 'storage'` và từ chối lưu trữ bền vững khi `retentionDays <= 0` (`retention_zero_denied`).
- Định dạng `consentRevision` và `providerRevision` bắt buộc là chuỗi số thập phân dương chuẩn tắc (`/^[1-9][0-9]*$/`), bác bỏ số 0 hoặc số có số 0 ở đầu ("0", "01").

### 4. Kiểm Thực Tham Số Fail-Closed Theo Schema Phương Thức Cố Định:
- `validateSlackToolExecutionArgs` từ chối hoàn toàn tham số tuỳ ý (`additionalProperties: false` fail-closed). Mọi tham số lạ nằm ngoài `tool.inputSchema.properties` đều ném `TypeError`.
- Định nghĩa schema tham số cố định mẫu cho 4 core 03C tools (`conversations.history`, `conversations.list`, `chat.postMessage`, `users.info`) với user scopes đối chiếu chính xác từ inventory.
- Phân biệt rõ ràng giữa phương thức có scopes (`string[]`) và phương thức chưa xác định scopes (`null` cho 89 phương thức probe).

### 5. Chính Xác 36 Snapshot Families & Đối Soát Cơ Học Sổ Cái 354 Methods:
- Loại bỏ hoàn toàn literal ellipsis (`...`) và các tên không có trong sitemap (`skills`, `misc`). Sử dụng union chính xác 36 string literals:
  `'admin' | 'agents' | 'api' | 'apps' | 'assistant' | 'auth' | 'blocks' | 'bookmarks' | 'bots' | 'calls' | 'canvases' | 'chat' | 'conversations' | 'dialog' | 'dnd' | 'emoji' | 'entity' | 'files' | 'functions' | 'migration' | 'oauth' | 'openid' | 'pins' | 'reactions' | 'reminders' | 'rtm' | 'search' | 'slackLists' | 'slackbot' | 'stars' | 'team' | 'tooling' | 'usergroups' | 'users' | 'views' | 'workflows'`.
- Tệp `docs/superpowers/plans/slack-354-method-ledger.json` được tái kết xuất tự động từ `docs/slack/method-inventory.json`, bảo toàn 100% 354 phương thức (101 excluded, 253 probe_required, 265 with_scopes, 89 unknown_scopes).

---

## 2. Kết Quả Kiểm Tra working tree & Lệnh Kiểm Thử

| Tiêu chuẩn kiểm tra | Kết quả thực tế |
|---|---|
| Lệnh kiểm tra tests Slack | `npx vitest run packages/tool-schemas/tests/myslack-context.test.ts packages/tool-schemas/tests/myslack-policy.test.ts packages/tool-schemas/tests/myslack-connection.test.ts`: **116/116 tests PASS** |
| Kiểm tra cú pháp Whitespace | `git diff --check b757ae0`: Sạch sẽ, exit code 0 |
| Bảo toàn mã nguồn sản phẩm | Không có bất kỳ file nào trong `apps/`, `packages/`, `db/` bị sửa đổi |
| Bảo toàn tài liệu quản trị | Không sửa `CURRENT-STATE.md`, `ROADMAP.md` hay 02 cards |
| Số lượng file trong PR #194 | Đúng 4 file tài liệu kế hoạch |

---

## 3. Danh Mục Tài Liệu Cập Nhật Trong PR #194

1. `docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`: Kế hoạch chi tiết 5 task TDD.
2. `docs/handoff/tasks/SLACK-03A-source-contracts.md`: Task card bounded SLACK-03A.
3. `docs/superpowers/plans/slack-354-method-ledger.json`: Sổ cái đối soát cơ học 354 phương thức.
4. `docs/handoff/log/2026-10-29-slack-03a-source-contracts-plan.md`: Handoff log hiệu chỉnh này.

Sẵn sàng commit, push bổ sung vào nhánh `VinhDat267/docs-slack-03a-source` của PR #194 và gửi `worker_done` với task ID `task_6b2369baa9a7` và dispatch ID `ctx_f9334c0e5308`.
