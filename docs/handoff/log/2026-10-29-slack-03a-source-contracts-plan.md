# 29/10/2026 · Hoạch Định SLACK-03A: Hợp Đồng Nguồn, ACL, Vòng Đời & Siêu Dữ Liệu Công Cụ (Hiệu Chỉnh Cơ Học)

**Tác giả:** Integration / Schema Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng (Coordinator) chỉ định Antigravity builder hoàn thiện kế hoạch chi tiết và task card cho **SLACK-03A** (Hợp đồng vòng đời nguồn, ACL, cascade purge và siêu dữ liệu công cụ theo phương thức).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**.
**Nhánh công việc:** `VinhDat267/docs-slack-03a-source` (phân nhánh từ `integration/slack-personal-20261029` tại `b757ae0`).
**Task card cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](../tasks/SLACK-03-tool-catalog-and-source-lifecycle.md).
**Task card bounded:** [`docs/handoff/tasks/SLACK-03A-source-contracts.md`](../tasks/SLACK-03A-source-contracts.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`](../../superpowers/plans/2026-10-29-slack-03a-source-contracts.md).
**Sổ cái kiểm kê 354 methods:** [`docs/superpowers/plans/slack-354-method-ledger.json`](../../superpowers/plans/slack-354-method-ledger.json) (sourceCommit `811f5dc9121d372f232efb63d9880d9574648e3a`, SHA256 `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`).

---

## 1. Khắc Phục Triệt Để 3 Yêu Cầu Hiệu Chỉnh Kỹ Thuật (Review Feedback)

### 1. Khôi phục Đầy đủ Lý do Loại trừ 101 Phương thức từ `method.reason`:
- **Phát hiện lỗi:** Bản trước đọc `m.exclusionReason`, một trường không tồn tại trong `docs/slack/method-inventory.json`, dẫn đến việc 101 phương thức excluded bị gán giá trị `null`.
- **Biện pháp xử lý:** Tái kết xuất cơ học toàn bộ giá trị từ trường `m.reason`. Chạy assertion tự động so khớp từng phương thức trong toàn bộ 354 entries:
  - 96 methods: `"Reviewed method page explicitly restricts availability to Enterprise plans, so this is not a Free/Pro user tool."`
  - 2 methods: `"Method usage requires an app-level token; excluded from user-token business tools. Event authorization lookup remains separate infrastructure."`
  - 3 methods: `"Method page explicitly documents deprecation, retirement or non-functional behavior; outside the non-deprecated API target."`
  - 100% 101 phương thức excluded đều có lý do xác thực, không có phương thức nào bị `null`.

### 2. Định danh Nguồn Bất Biến & Mã Băm Tệp Chuẩn Xác:
- Thay thế chuỗi viết tắt bằng `sourceCommit: "811f5dc9121d372f232efb63d9880d9574648e3a"` (commit đầy đủ của PR 185).
- Bổ sung `inventoryFileSha256: "e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09"` tính toán trực tiếp từ mảng bytes của tệp `docs/slack/method-inventory.json`.
- Bảo toàn nguyên trạng phân loại: 253 `probe_required` (với 89 phương thức có `userScopes: null` chưa rõ token eligibility), 101 `excluded`.

### 3. Tinh Chỉnh Hàm `decideSlackSourceStorage` & Yêu Cầu Backend Revalidation:
- Hàm pure `decideSlackSourceStorage` uỷ quyền trực tiếp cho `decideSlackModelUse` để tái sử dụng toàn bộ baseline policy gates (`connection_inactive`, `consent_missing`, `policy_changed`, `provider_unverified`, `retention_exceeded`), không tạo engine chính sách song song.
- Bổ sung các điều kiện storage: kiểm tra `sameSlackBinding(request.binding, request.policyRef.binding)`, kiểm tra `purpose === 'storage'`, cấm lưu trữ lâu dài khi `retentionDays <= 0` (`retention_zero_denied`), và kiểm tra TTL số nguyên an toàn dương được giới hạn bởi consent/provider.
- **Yêu cầu đối với Backend Runtime:** Schemas thuần chỉ là hợp đồng giao tiếp, không tự xác lập tính sống động (liveness). Backend bắt buộc revalidate `consentRevision`, `providerRevision` và ACL của caller tại mọi thời điểm tiêu thụ nguồn hoặc bộ nhớ; từ chối ngay lập tức nếu consent đã bị thu hồi/cấp lại dưới revision mới.

---

## 2. Kết Quả Kiểm Tra working tree & Lệnh Kiểm Thử Thực Tế

| Tiêu chuẩn kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Môi trường dependencies | `npm ci` do coordinator khởi tạo | Đã hoàn tất provisioning đầy đủ lockfile dependencies |
| Bộ test package `@wap/tool-schemas` | `npm test -w @wap/tool-schemas` | **13 test files PASS, 183 tests PASS**, exit code 0 |
| Bộ test Slack foundation | `npx vitest run packages/tool-schemas/tests/myslack-context.test.ts packages/tool-schemas/tests/myslack-policy.test.ts packages/tool-schemas/tests/myslack-connection.test.ts` | **3 test files PASS, 116 tests PASS**, exit code 0 |
| Đối soát cơ học 354 entries | Chạy script kiểm tra assertion tự động | **100% 354 entries PASS** (101 excluded có đầy đủ lý do, 253 probe_required) |
| Kiểm tra cú pháp Whitespace | `git diff --check b757ae0` | Sạch sẽ, exit code 0, không có trailing whitespace |
| Bảo toàn mã nguồn sản phẩm | Kiểm tra `apps/`, `packages/`, `db/` | Không có bất kỳ file sản phẩm nào bị sửa đổi |
| Bảo toàn tài liệu quản trị | Kiểm tra `CURRENT-STATE.md`, `ROADMAP.md` | Không có bất kỳ thay đổi nào |

---

## 3. Danh Mục Tài Liệu Bàn Giao Trong PR #194

1. `docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`: Kế hoạch chi tiết 5 task TDD.
2. `docs/handoff/tasks/SLACK-03A-source-contracts.md`: Task card bounded SLACK-03A.
3. `docs/superpowers/plans/slack-354-method-ledger.json`: Sổ cái đối soát cơ học 354 phương thức kèm mã băm SHA-256.
4. `docs/handoff/log/2026-10-29-slack-03a-source-contracts-plan.md`: Handoff log ghi nhận chi tiết phiên hiệu chỉnh này.

Sẵn sàng commit, push bổ sung vào nhánh `VinhDat267/docs-slack-03a-source` của PR #194 và gửi `worker_done` với task ID `task_b8910654f622` và dispatch ID `ctx_1dda28ac2db8`.
