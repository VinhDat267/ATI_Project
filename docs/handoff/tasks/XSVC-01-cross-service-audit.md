# XSVC-01 · Kiểm toán liên dịch vụ

**Trạng thái:** pha 0 xong (bản đồ tĩnh). Pha 1–3 chưa làm. · **Nhánh:** `docs/xsvc-01-cross-service-audit` · **Không sửa mã sản phẩm trong pha 0**

## Mục tiêu

Đối chiếu cách các dịch vụ truyền dữ liệu cho nhau và ghi bug có tái hiện. Không kiểm lại từng adapter. Không coi Playwright `nine_service` là đã đóng kiểm toán.

## Pha

- [x] **Pha 0.** Bản đồ 12 dịch vụ, 95 tool, placeholder của plan sandbox, và lệch với sáu việc demo. Xem [inventory](../../audits/2026-11-07-cross-service/INVENTORY.md).
- [ ] **Pha 1.** Test tất định cho F1–F3 và cổng `enforceReportGrounding` lúc duyệt. Đột biến một khóa output.
- [ ] **Pha 2.** Một lượt đọc thật rồi Hủy. Browser sandbox `nine_service` đối chiếu `output_json`. Không ghi dịch vụ thật khi chưa được duyệt từng lệnh.
- [ ] **Pha 3.** `FINDINGS.md` và `SEAM-MATRIX.md`. Chỉ sửa P0, hoặc P1 chặn demo, trên nhánh riêng.

## Kết quả pha 0 (07/11/2026)

- Ba plan sandbox không có placeholder nào thiếu khóa schema. `trello.create_card.url` là optional.
- F1: `mysheets.create_doc` chỉ vào catalog khi đã chọn ít nhất một bảng tính. UI `scope_required` cũng đòi bảng tính. Default `folderId` không đủ cho OFF-02.
- F2: adapter Trello đổi `url` thiếu thành `''`. Bước sau vẫn gửi được chuỗi rỗng.
- F3: `schedule_meet` có thể trả output không có `meetLink`. Template bước sau sẽ lỗi sau khi sự kiện đã tạo.
- F4: biên nhận transition tìm `newStatus`; schema có `status`.
- F5: `timeMax` 23:59:59 còn trong `resolveNaturalWindowFromQuery`.
- `ExecutionService` trong `server.ts` không bật `enforceReportGrounding`. `ChatService` bật lúc lưu plan. Pha 1 phải kiểm lượt lịch.
- Chưa chạy test mới, chưa chạy live, chưa commit.
