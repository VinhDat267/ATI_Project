# FE-06 · Cockpit: lỗi, chưa rõ kết quả, khôi phục; màn từ chối và hỏi lại; lỗi chung

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-06-cockpit-recovery` · **Phụ thuộc:** FE-05b đã merge (khoảnh khắc 7–9 dựng trên khung mới); UI-API-01 phần 1 cho nút "Kết nối <dịch vụ>" · **Mốc:** 20/10/2026
**Đặc tả:** mục 1.1, 5, 6, 9 · **Bản mẫu:** `app-stage.html` khoảnh khắc 7–9, `responses.html` (4 tình huống), `errors.html`

## Vì sao quan trọng

Điểm khác biệt của ATI là xử lý trung thực khi có sự cố: không chạy lại lệnh ghi chưa rõ kết quả, khôi phục sau khi máy chủ khởi động lại, từ chối rõ ràng khi thiếu dịch vụ. Hiện các tình huống này nằm trong `PartialFailureModal` và `ReconciliationNotice` với chữ kỹ thuật ("UNKNOWN", tên tool).

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `AppStage/AppStagePage.tsx` (khoảnh khắc 7–9), `Responses/ResponsesPage.tsx` (4 tình huống, dựng trong cockpit), `Errors/ErrorsPage.tsx` (trạng thái lỗi chung, dựng ở đúng chỗ trong cockpit và toàn app) từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

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
9. *(Chuyển sang [FE-05b](FE-05b-cockpit-visual-parity.md) mục 9–11 ngày 06/10/2026, vì FE-05b dựng lại vùng cuộn, thanh trên và ngăn hội thoại: hai P3 vị trí cuộn và focus khi đổi khoảnh khắc, định dạng thời lượng, thu gọn phần đầu trang ở 375px, dòng tóm tắt trong ngăn hội thoại.)*

## Tiêu chí nghiệm thu

- [ ] Test: bước `unknown` không có hành động chạy lại ở bất kỳ đâu trên giao diện; chỉ "Bỏ qua" và "Dừng".
- [ ] Test: nút khôi phục hiện đúng theo `recoveryActions` của snapshot (thiếu `continue` thì không có "Làm tiếp").
- [ ] Test: từ chối có `unavailableServices` → quản trị viên thấy link `/settings#<id>`, thành viên không thấy; không có `unavailableServices` (dữ liệu cũ) → vẫn hiển thị lý do văn bản.
- [ ] Test phản hồi muộn: lệnh khôi phục của plan A trả về sau khi người dùng đã sang hội thoại B → không đổi màn của B.
- [ ] Các test W2-04, W2-05, `partial-failure-modal`, `execution-progress` được chuyển sang component mới, không mất ca.
- [ ] Browser: sandbox có kịch bản bước `unknown` và `reconciliation_required` (thêm vào harness nếu chưa có) chạy đúng; không cuộn ngang ở 375px.
- [ ] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app đặt cạnh ảnh bản React ở 1440×900 và 375×812, sáng và tối, cho `app-stage.html` khoảnh khắc 7–9, `responses.html` (4 tình huống) và `errors.html`. Màn kết thúc không thành công so với khoảnh khắc 6. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Thay đổi hành vi planner (W3-10), thay đổi chính sách khôi phục của executor.

## Kết quả

_(agent thi công điền)_
