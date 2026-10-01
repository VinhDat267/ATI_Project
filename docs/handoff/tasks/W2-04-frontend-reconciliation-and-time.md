# W2-04 · Frontend: hiện trạng thái cần đối soát, sửa định dạng thời gian

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w2-04-reconciliation-ui` · **Phụ thuộc:** W2-02 đã merge

## Vấn đề

1. Khi mở lại một hội thoại có plan `reconciliation_required`, frontend chưa giải thích cho người dùng chuyện gì đã xảy ra và họ cần làm gì.
2. Thời gian dưới tin nhắn người dùng hiện dạng ISO thô (ví dụ `2026-10-01T03:37:59.930Z`), trong khi lịch sử hội thoại hiện giờ:phút.

## Việc cần làm

1. Khi plan đang `reconciliation_required`: hiện một thông báo rõ ràng, liệt kê step `unknown` (tool, mô tả, argument đã resolve nếu có), hướng dẫn người dùng tự kiểm tra trên service, và hai nút **Skip step này rồi chạy tiếp** / **Dừng plan** gọi API của W2-02. Không có nút retry cho step `unknown`.
2. Định dạng thời gian thống nhất cho mọi tin nhắn (giờ:phút theo giờ máy người dùng; nếu khác ngày thì thêm ngày).

## Tiêu chí nghiệm thu

- [ ] Component test cho thông báo đối soát: hiện đúng step `unknown`, không có nút retry, hai nút gọi đúng API.
- [ ] Test định dạng thời gian cho tin nhắn vừa gửi và tin nhắn tải lại từ lịch sử.
- [ ] Thêm một kịch bản browser E2E: plan bị đặt vào trạng thái `reconciliation_required` trong database → mở hội thoại → thấy thông báo → Skip → plan `completed`.
- [ ] Ảnh chụp màn hình thông báo đính kèm trong PR.
- [ ] `npm run test:v3`, `npm run typecheck:v3`, `npm run build:v3` đạt; browser E2E đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
