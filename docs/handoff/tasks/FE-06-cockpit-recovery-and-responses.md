# FE-06 · Cockpit: lỗi, chưa rõ kết quả, khôi phục; màn từ chối và hỏi lại; lỗi chung

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-06-cockpit-recovery` · **Phụ thuộc:** FE-05 đã merge; UI-API-01 phần 1 cho nút "Kết nối <dịch vụ>" · **Mốc:** 20/10/2026
**Đặc tả:** mục 5, 6, 9 · **Bản mẫu:** `app-stage.html` khoảnh khắc 7–9, `responses.html` (4 tình huống), `errors.html`

## Vì sao quan trọng

Điểm khác biệt của ATI là xử lý trung thực khi có sự cố: không chạy lại lệnh ghi chưa rõ kết quả, khôi phục sau khi máy chủ khởi động lại, từ chối rõ ràng khi thiếu dịch vụ. Hiện các tình huống này nằm trong `PartialFailureModal` và `ReconciliationNotice` với chữ kỹ thuật ("UNKNOWN", tên tool).

## Việc cần làm

1. **Khoảnh khắc 7 · Lỗi đã biết:** chuyện gì đã xảy ra, ảnh hưởng hiện tại, việc cần làm. Nút theo `recoveryActions`: Thử lại, Sửa rồi thử lại (giữ chức năng sửa tham số của `PartialFailureModal`, nhưng trình bày bằng trường có nhãn thay vì JSON thô khi có schema), Bỏ qua, Dừng (có xác nhận).
2. **Khoảnh khắc 8 · Chưa rõ kết quả:**
   - nói rõ hệ thống không chắc lệnh đã tới dịch vụ hay chưa;
   - link "Kiểm tra trên <dịch vụ>" nếu biết đích;
   - chỉ hai lựa chọn: "Đã thấy kết quả → Bỏ qua bước này và làm tiếp", "Dừng kế hoạch";
   - không có nút chạy lại; câu hướng dẫn "Nếu chưa có: dừng kế hoạch rồi gửi lại yêu cầu".
3. **Khoảnh khắc 9 · Khôi phục sau khi máy chủ khởi động lại:** danh sách việc đã xong (có link), chưa làm; nút "Làm tiếp các việc còn lại" khi có `continue`, "Dừng". Thay `ReconciliationNotice`.
4. **Kết thúc không thành công** (`stopped`, `rejected`, `failed`): tóm tắt việc đã làm/chưa làm và "Nhờ việc khác" (bố cục như khoảnh khắc 6).
5. **Màn từ chối** (`responses.html` 1–2):
   - dịch vụ chưa kết nối: dùng `unavailableServices` từ UI-API-01; trạng thái từng dịch vụ trong yêu cầu; quản trị viên có nút "Kết nối <dịch vụ>" tới `/settings#<id>` (nhiều dịch vụ thì tới `/settings`); thành viên chỉ có câu "Chỉ quản trị viên kết nối được dịch vụ mới…";
   - việc chưa làm được: lý do và gợi ý của planner; nút "Sửa yêu cầu" đưa câu cũ vào ô nhập;
   - câu "Chưa có gì được ghi lên công cụ nào." trên mọi màn từ chối/hỏi lại.
6. **Màn hỏi lại mở rộng** (`responses.html` 3–4): yêu cầu chỉ để xem (khi W3-10 đã merge; trước đó vẫn hiển thị đúng nếu planner trả clarification), không thấy nơi cần ghi (kèm dòng phụ khác nhau cho quản trị viên/thành viên).
7. **Lỗi chung** (`errors.html`):
   - mất mạng: dải trên cùng, "Thử lại"; không hứa tự đồng bộ;
   - hết phiên: đưa về đăng nhập với câu "Phiên đăng nhập đã hết hạn"; không hứa lưu bản nháp;
   - lập kế hoạch lâu (quá 15 s): hiển thị tiến trình tra cứu thật từ `gatherState`; "Thôi chờ, giữ lại câu yêu cầu" kèm câu "Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt";
   - lỗi máy chủ: câu của hệ thống "Không thể lập kế hoạch lúc này. Hãy thử lại."; không mã lỗi tự đặt.
8. Bỏ `PartialFailureModal` và `ReconciliationNotice` khi đã có thay thế; giữ nguyên lời gọi API khôi phục.
9. **Sửa từ kiểm tra app thật FE-05 (Claude Code, 06/10/2026, sandbox, head `09b8031`):**
   - **P3 — vị trí cuộn khi đổi khoảnh khắc:** vùng nội dung cockpit giữ `scrollTop` của khoảnh khắc trước. Ví dụ: cuộn xuống để bấm Duyệt (scrollTop 93px) thì tiêu đề "ATI đang làm" và "Việc đã xong" bị khuất một phần, ở cả 1440px và 375px. Mỗi lần khoảnh khắc đổi thì cuộn vùng nội dung về đầu.
   - **P3 — mất focus sau khi duyệt:** nút "Duyệt kế hoạch" biến mất khi sang khoảnh khắc 5, focus rơi về `body`. Khi khoảnh khắc đổi do hành động của người dùng hoặc do dữ liệu mới, đưa focus vào `h1` của khoảnh khắc mới (`tabIndex={-1}`). **Không** giành focus khi người dùng đang gõ trong ô nhập hoặc đang ở trong ngăn kéo/hộp thoại.
   - Góp ý nhỏ, làm nếu kịp:
     - thời lượng dùng định dạng Việt ("0,005 giây" hoặc "< 0,1 giây"), không "0.005s"/"0.0 giây";
     - ở 375px phần đầu trang (thanh trên, dải thử nghiệm, 4 nút, "Yêu cầu hiện tại") chiếm gần nửa chiều cao, nên gộp hoặc thu gọn;
     - ngăn hội thoại hiện có tin của người dùng và tin lỗi, chưa có dòng cho kế hoạch đã duyệt hoặc biên nhận. Xem xét thêm một dòng tóm tắt (không chép JSON).

## Tiêu chí nghiệm thu

- [ ] Test: bước `unknown` không có hành động chạy lại ở bất kỳ đâu trên giao diện; chỉ "Bỏ qua" và "Dừng".
- [ ] Test: nút khôi phục hiện đúng theo `recoveryActions` của snapshot (thiếu `continue` thì không có "Làm tiếp").
- [ ] Test: từ chối có `unavailableServices` → quản trị viên thấy link `/settings#<id>`, thành viên không thấy; không có `unavailableServices` (dữ liệu cũ) → vẫn hiển thị lý do văn bản.
- [ ] Test phản hồi muộn: lệnh khôi phục của plan A trả về sau khi người dùng đã sang hội thoại B → không đổi màn của B.
- [ ] Các test W2-04, W2-05, `partial-failure-modal`, `execution-progress` được chuyển sang component mới, không mất ca.
- [ ] Browser: sandbox có kịch bản bước `unknown` và `reconciliation_required` (thêm vào harness nếu chưa có) chạy đúng; không cuộn ngang ở 375px.
- [ ] Browser (mục 9): cuộn xuống ở khoảnh khắc 4, bấm Duyệt → ở khoảnh khắc 5 và 6, `h1` nằm trọn trong vùng nhìn thấy và nhận focus; đang gõ trong ô nhập khi khoảnh khắc đổi thì focus vẫn ở ô nhập. Kiểm ở 1440px và 375px.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Thay đổi hành vi planner (W3-10), thay đổi chính sách khôi phục của executor.

## Kết quả

_(agent thi công điền)_
