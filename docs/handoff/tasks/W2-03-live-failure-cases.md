# W2-03 · Chạy thật các ca lỗi của service

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w2-03-live-failure-cases` · **Phụ thuộc:** không (ca 4 nên làm sau W2-01)

## Vấn đề

Cách hệ thống xử lý lỗi của Trello, Slack, GitHub mới được test bằng `fetch` giả. Báo cáo cuối kỳ cần bằng chứng trên service thật cho các ca lỗi, không chỉ ca thành công.

## Các ca cần chạy

| # | Ca | Cách tạo | Kết quả mong đợi | Có ghi ra service thật? |
|---|---|---|---|---|
| 1 | Ngoài allowed scope | Plan nhắm tới board/channel/repo không nằm trong `LIVE_*` | Adapter từ chối **trước** khi gọi API; step `failed` | Không |
| 2 | Token sai hoặc hết hạn | Chạy với một token cố ý sai cho một service (chỉ đổi trong tiến trình chạy, không sửa `.env`) | Lỗi `AUTH_ERROR`, step `failed`, không retry | Không |
| 3 | Rate limit 429 | Không tạo được an toàn trên service thật | Giữ test bằng `fetch` giả; ghi rõ trong báo cáo là chưa chạy thật | Không |
| 4 | Timeout khi ghi | Đặt timeout của adapter rất nhỏ cho một lệnh ghi | Step `unknown`, không tự chạy lại; kiểm tra trên service xem lệnh có được thực hiện không | **Có** — cần người dùng duyệt plan trước, và dọn dẹp sau |

## Việc cần làm

1. Mở rộng `evaluations/live-execution/` (hoặc thêm script) để chạy từng ca và ghi bằng chứng vào `docs/ai-evidence/V3-LIVE-EXECUTION/` (thư mục này **không commit**, đã nằm trong `.git/info/exclude` ở máy nhóm trưởng).
2. Ca 4 ghi ra service thật: theo đúng quy trình `plan` → người dùng duyệt hash → `execute --confirm <hash>`.
3. Thêm một mục vào `evaluations/README.md` tóm tắt kết quả từng ca (không chứa token, ID nhạy cảm).

## Quy tắc an toàn

- Không in token ra log. Không sửa `.env` của người dùng.
- Chỉ dùng tài nguyên thử nghiệm: Trello board "To Do", Slack `#ati-test`, GitHub `VinhDat267/ati-test`.
- Mọi lệnh ghi ra service thật cần người dùng duyệt đúng plan đó trong chat.

## Tiêu chí nghiệm thu

- [ ] Ca 1, 2, 4 có bằng chứng chạy thật (output lệnh, trạng thái trong database hoặc kết quả trả về), ca 3 ghi rõ lý do chưa chạy thật.
- [ ] Nếu một ca cho kết quả khác mong đợi: ghi lại, mở task sửa riêng, không sửa lén trong PR này.
- [ ] `evaluations/README.md` cập nhật; `npm run test:eval:v3` đạt.

## Kết quả (agent thi công điền)

- PR:
- Bằng chứng (đường dẫn ở máy):
- Kết quả từng ca:
- Điều chưa làm hoặc khác với task card:
