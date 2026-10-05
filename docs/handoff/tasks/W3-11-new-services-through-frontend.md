# W3-11 · Chạy thật năm service mới qua frontend

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w3-11-new-services-frontend` · **Phụ thuộc:** W3-07 (đã xong), tài nguyên thử nghiệm của W3-07 còn dùng được, cổng LLM hoạt động (hoặc provider dự phòng [W4-00](W4-00-llm-fallback-provider.md)); nên xong trước buổi thử W4-03 · **Có phần việc của con người:** duyệt từng plan ghi, tự nhập credentials trên giao diện

## Vấn đề

W3-07 chạy thật năm service mới qua `evaluations/live-execution/run.ts`, không qua giao diện. Bước 2 của task card W3-07 ("một lệnh ghi thật qua frontend") chưa làm.

Lần chạy qua frontend duy nhất là ngày 30/09, với GitHub → Trello → Slack. Từ đó sản phẩm đã đổi nhiều:
- đăng nhập, phiên và tài khoản (AUTH-01 → AUTH-06);
- điều hướng `/`, `/login`, `/c/:id` (FE-02);
- plan preview và màn hình kết quả (FE-03);
- form cấu hình service lấy từ API (W3-00b).

Buổi thử W4-03, phép đo W4-04 và demo cuối kỳ đều đi qua giao diện ở chế độ live, nên lỗi tích hợp phải lộ ra trước các mốc đó.

Harness `evaluations/live-app/` sửa lần cuối ngày 01/10. `live-app.e2e.ts` mở `/` rồi điền form đăng nhập ngay; `setup-credentials.ts` đọc `accessToken` từ phản hồi login. Cả hai cần kiểm lại với giao diện và API hiện tại.

## Chuẩn bị của người dùng

- `.env` có credentials và allowlist của tám service như W3-07. Tài nguyên thử nghiệm:
  - Trello board "To Do", Slack `#ati-test`, GitHub `VinhDat267/ati-test`;
  - Sheets "ATI Test Tracker", Calendar "ATI Test", Notion "ATI Test Notes";
  - nhóm Telegram thử, Jira project `ATIT`.
- Cổng LLM đang chạy.
- Ở mục 3, người dùng tự gõ hoặc dán credentials vào giao diện; agent không đọc, không in.

## Việc cần làm

1. Khởi động `RUNTIME_MODE=live npm run up` (migrations và admin như hướng dẫn AUTH-06 trong `evaluations/README.md`), kiểm `/api/health`.
2. Cập nhật `evaluations/live-app/` theo giao diện hiện tại: đăng nhập, nút Duyệt/Hủy, dòng tiến độ, link kết quả. Chạy một lượt **chỉ tới preview rồi Hủy**: plan `rejected`, không có dòng nào trong `execution_steps`.
3. Lưu credentials cho tám service bằng `setup-credentials.ts`.
   - Riêng **một** service Google (Sheets hoặc Calendar), người dùng nhập qua trang cài đặt dịch vụ trên giao diện, để kiểm ô private key nhiều dòng (W3-00b) với giá trị thật.
   - "Kiểm tra kết nối" của cả tám service đều OK.
4. Với **mỗi** service mới (Sheets, Calendar, Notion, Telegram, Jira): một yêu cầu bằng câu chat thường, có ghi vào service đó (có thể kèm Slack).
   - Tại preview, kiểm và chụp: tên tài nguyên hiện thay cho ID, có nhãn Đọc/Ghi (FE-03).
   - Người dùng duyệt **đúng mã băm** trong chat trước khi harness bấm Duyệt (`confirm.txt`).
   - Sau khi chạy, đối chiếu ba nơi:
     - giao diện hiện kết quả với link hoặc ID an toàn;
     - `plans` và `execution_steps` trong PostgreSQL là `completed`/`succeeded`;
     - đọc lại kết quả bằng tool đọc của service. Riêng Telegram: người dùng xác nhận bằng mắt, có ảnh chụp, như W3-07.
5. **Một workflow qua ≥ 4 service, trong đó ≥ 2 service mới, có phụ thuộc dữ liệu giữa các bước**, chạy qua giao diện với quy trình duyệt và đối chiếu như mục 4.
6. Ghi thời gian tới preview của từng lượt. Đây không phải phép đo chính thức của W4-04.
7. Khi phát hiện lỗi: ghi lại kèm bằng chứng và đề xuất task card riêng.
   - PR này chỉ sửa harness `evaluations/live-app/`, không sửa mã sản phẩm.
   - Lỗi chặn các bước sau thì dừng và báo người dùng.

## Quy tắc an toàn

- Chỉ ghi vào tài nguyên thử nghiệm đã nêu. Mọi lệnh ghi cần người dùng duyệt đúng plan đó trong chat.
- Không in token, private key, email; ảnh chụp che email và token.
- Dọn dẹp chỉ khi người dùng yêu cầu, và do người dùng làm trên giao diện của service.
- Bằng chứng lưu ở `docs/ai-evidence/V3-LIVE-EXECUTION/` (đã ignore, không commit); PR chỉ có tóm tắt.

## Tiêu chí nghiệm thu

- [ ] Harness chạy được với giao diện hiện tại; lượt hủy có plan `rejected` và 0 dòng `execution_steps`.
- [ ] Mỗi service mới: một lần ghi thật qua giao diện, người dùng đã duyệt mã băm, có đối chiếu giao diện, PostgreSQL và đọc lại.
- [ ] Một workflow ≥ 4 service (≥ 2 service mới) thành công qua giao diện, đối chiếu từng bước.
- [ ] Một service Google được nhập credentials qua giao diện, kiểm tra kết nối OK.
- [ ] `evaluations/README.md` mục "Through the app" được cập nhật; `npm run check` exit 0.
- [ ] Không có bí mật trong PR, log hay ảnh chụp.

## Kết quả (agent thi công điền)

- PR:
- Bằng chứng (đường dẫn ở máy):
- Kết quả từng service và workflow (plan hash, trạng thái step, ID kết quả đã che bớt nếu cần):
- Lỗi phát hiện và task đề xuất:
- Điều chưa làm hoặc khác với task card:
