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

- PR: [#20](https://github.com/VinhDat267/ATI_Project/pull/20), stack trên W2-02 #18; chưa merge.
- Commit: source `30784eb84aa8e4bd643c55d99cc346307f8a140f`, base `31670bc58f7f93a9c5f76f51369c7c7d0bb39bd5`.
- Test đã chạy và kết quả: baseline442/442; test mới RED19failed/9passed, thêm quyền partial/time RED3failed/15passed, SSE replay RED2failed/14passed, argument context RED1failed/8passed; browser PostgreSQL thật RED1failed (thiếu region). GREEN `npm run check` exit0: v3 **472/472**, eval66/66, typecheck/build exit0, launcher1/1/local-env3/3; browser đầy đủ **7/7**, exit0. Ảnh desktop/mobile trong `apps/chat-web/docs/evidence/` và PR. Independent review/CI đang chạy trước ready; chi tiết trong nhật ký W2-04.
- Điều chưa làm hoặc khác với task card: user yêu cầu triển khai ngay sau merge #17→#15, vì vậy stack trên #18 còn OPEN; phải merge #18, retarget main và xác nhận CI trước merge #20. Không retry UNKNOWN, snapshot invalid là Stop-only, không sửa argument của executable plan. Argument hiển thị được dựng từ saved plan/output; không chứng minh request provider thực tế. Chưa chạy live model/provider, không đổi backend/schema/v2 hoặc CURRENT-STATE/ROADMAP.
