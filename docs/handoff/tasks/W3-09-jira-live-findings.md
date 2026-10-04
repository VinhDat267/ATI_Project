# W3-09 · Jira: tìm kiếm với dấu gạch ngang và báo đúng lỗi token khi đọc

**Trạng thái:** chờ · **Nhánh gợi ý:** `fix/w3-09-jira-live-findings` · **Phụ thuộc:** không

Nguồn: chạy thật Jira trong W3-07 ngày 04/10/2026 (site Jira Cloud Free, project `ATIT`).

## 1. Tìm kiếm trượt với từ có dấu gạch ngang (trung bình)

- **Hiện trạng:** `jira.search_issues` thay các ký tự đặc biệt của Lucene (`+ - & | ! ( ) { } [ ] ^ ~ * ? :`) bằng khoảng trắng, rồi escape lớp JQL (`jira-adapter.ts`, nhánh `jira.search_issues`).
- **Bằng chứng thật:** ticket `ATIT-4` có tiêu đề `Kiểm tra W3-07 Jira`.
  - Query `Jira` thấy ticket.
  - Query `W3` và query nguyên tiêu đề trả rỗng.
- **Ảnh hưởng:** người dùng nhắc ticket theo mã hoặc phiên bản có gạch ngang (`W3-07`, `v2-beta`, `ATIT-4`) thì model không tìm thấy và phải hỏi lại.
- **Yêu cầu:**
  - đọc tài liệu text search hiện hành của Jira Cloud;
  - giữ nguyên an toàn chống chèn JQL (toàn bộ câu nằm trong chuỗi JQL có escape);
  - escape ký tự Lucene thay vì xóa, ít nhất với `-`, theo cách Jira cho phép trong text search;
  - nếu query có dạng issue key (`^[A-Z][A-Z0-9_]{1,9}-\d+$`) thuộc project được phép, tìm thẳng theo `key = "..."` ngoài điều kiện `text ~`.
- **Test:**
  - JQL sinh ra cho `W3-07` và `ATIT-4`;
  - các chuỗi chèn cũ vẫn bị chặn;
  - ghi rõ trong PR rằng hành vi tìm kiếm thật cần kiểm lại bằng `run.ts` (W3-07) sau khi merge.

## 2. Token sai bị báo `NOT_FOUND` khi đọc (thấp)

- **Hiện trạng:** với Basic auth sai, Jira Cloud trả 401 cho `/myself`, nhưng **404 cho `/project/ATIT`** (coi là ẩn danh và giấu project). `run.ts check` và các tool đọc project/issue vì vậy báo `NOT_FOUND`.
- **Ảnh hưởng:** token hết hạn giữa chừng workflow hiện ra như "không tìm thấy project/issue", khiến người dùng tìm nhầm chỗ lỗi. Nút "Kiểm tra kết nối" trong app dùng `/myself` nên đã đúng.
- **Yêu cầu:** khi đọc project/issue trong allowlist mà nhận 404, gọi `/myself` một lần. Nếu `/myself` trả 401/403 thì báo `AUTH_ERROR`; nếu không thì giữ `NOT_FOUND`. Không áp dụng cho lệnh ghi đã gửi đi: lệnh ghi lỗi vẫn theo quy tắc hiện tại.
- **Test:** 404 + `/myself` 401 → `AUTH_ERROR`; 404 + `/myself` 200 → `NOT_FOUND`; số request tối đa thêm 1; thông báo lỗi không chứa token.

## Tiêu chí nghiệm thu

- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.
- [ ] Sau khi merge: chạy lại `run.ts check` với token giả (phải ra `AUTH_ERROR`) và đọc lại `ATIT-4` bằng query `W3-07` (phải tìm thấy). Chỉ đọc, không ghi.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
