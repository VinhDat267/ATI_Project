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
- Commit: implementation `30784eb84aa8e4bd643c55d99cc346307f8a140f`, fix review `7932984991288f5a9d6cf8e1c7033607deac5792` và source cuối `63c3c63869be49b5724f9d9be75172dab320b16c`; base `31670bc58f7f93a9c5f76f51369c7c7d0bb39bd5`.
- Test đã chạy và kết quả: baseline442/442; initial RED19failed/9passed, partial/time RED3failed/15passed, SSE replay RED2failed/14passed, args RED1failed/8passed; real browser RED1failed (thiếu region). Independent review tại49cb9c5: check472/472 + eval66/66 + browser7/7, exit0; Chưa đạt với hai Important findings. Fix pass regression RED3failed/11passed; lifecycle RED2failed/3passed; GREEN16/16. Source cuối `npm run check` exit0: v3 **479/479**, eval66/66, typecheck/build exit0, launcher1/1/local-env3/3; browser **7/7**, exit0. Ảnh desktop/mobile trong `apps/chat-web/docs/evidence/` và PR; final exact-head CI được kiểm tra trước ready. Reviewer chưa chạy lại fixed head; chi tiết trong nhật ký W2-04.
- Điều chưa làm hoặc khác với task card: stack trên #18 còn OPEN theo yêu cầu implement-now; phải merge #18, retarget main và xác nhận CI trước merge #20. UI cũng đối soát paused UNKNOWN có status partial. Không retry UNKNOWN hoặc sửa executable args; invalid là Stop-only. Argument dựng từ saved plan/output, không phải actual provider request. Live model/provider NOT_RUN; không đổi backend/schema/v2/CURRENT-STATE/ROADMAP. Deferred Minor: frontend text_* streaming path chưa có timestamp/finalized message; chưa tìm thấy production emitter, reachability unproven; phải xử lý trước khi nối producer này.
