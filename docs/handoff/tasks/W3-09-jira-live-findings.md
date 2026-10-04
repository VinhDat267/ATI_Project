# W3-09 · Jira: tìm kiếm với dấu gạch ngang và báo đúng lỗi token khi đọc

**Trạng thái:** xong, #63 tại `f284b12`; review độc lập và nghiệm thu chỉ đọc sau merge đạt · **Nhánh thi công:** `fix/w3-09-jira-live-findings` · **Phụ thuộc:** không

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

- [x] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.
- [x] Sau khi merge: chạy lại `run.ts check` với token giả (phải ra `AUTH_ERROR`) và đọc lại `ATIT-4` bằng query `W3-07` (phải tìm thấy). Chỉ đọc, không ghi.

## Kết quả (agent thi công điền)

- PR: nhánh `fix/w3-09-jira-live-findings` (Claude Code thi công theo yêu cầu của người dùng).
- Commit: `48dbe69` (test RED), `74ed79a` (sửa), `58d705d` (thêm test cho mutation lọt), kèm commit tài liệu.
- Tài liệu đã đọc (04/10/2026), Atlassian Support, Jira Cloud:
  - "Search for work items using the text field":
    - `-` là toán tử loại trừ, `+` bắt buộc, `!`/`&&`/`||`/`( )` là toán tử;
    - cụm từ chính xác viết `text ~ "\"…\""`.
  - "What is advanced search in Jira Cloud?", mục "Restricted words and characters":
    - ký tự không phải chữ/số phần lớn không được index;
    - một số ký tự cần hai dấu backslash trong JQL, ví dụ `field ~ "\\(text"`.
- Cách sửa:
  - **Mục 1:**
    - escape bằng backslash các ký tự `+ - & | ! ( ) { } [ ] ^ ~ * ? : \ / "`, không xóa nữa; sau đó escape lớp JQL như cũ.
      - `W3-07` cho ra `text ~ "W3\\-07"`: một term giống như lúc Jira index.
      - Cả câu vẫn nằm trong một chuỗi `text ~ "…"`.
    - Query có dạng issue key (không phân biệt hoa thường) thuộc **đúng project đang tìm** thì đọc thẳng `GET /issue/{key}?fields=summary,status,project` trước text search.
      - Kết quả đọc thẳng đứng đầu, bỏ trùng, vẫn giới hạn bởi `limit`.
      - Key không tồn tại (404) hoặc issue đã chuyển sang project khác thì không tính, text search vẫn chạy.
  - **Mục 2:**
    - đọc nhận 404 (trừ chính `/myself`) thì gọi `/myself` **một lần, không retry**;
    - 401/403 thì `AUTH_ERROR`, mọi kết quả khác (200, 5xx, lỗi mạng) giữ `NOT_FOUND`;
    - lệnh ghi không đổi.
- Test đã chạy và kết quả (04/10/2026):
  - **RED trên `main` `87411bc`:** 11/11 fail đúng lý do:
    - `expected 'W3 07' to be 'W3\-07'`;
    - chưa đọc thẳng issue key;
    - read 404 ra `NOT_FOUND` mà không gọi `/myself`.
  - **GREEN:** `jira-adapter.test.ts` 58/58. Các test chống chèn JQL cũ vẫn đạt; assertion "ký tự bị xóa" đổi thành "ký tự được escape".
  - **Mutation:** 11/11 bị bắt. Lần đầu bỏ khử trùng lặp lọt vì `slice` che mất phần tử trùng; đã thêm test, chạy lại thì bị bắt.
  - **`npm run check`:** exit 0; v3 1.086 = 47 schema + 340 adapters + 180 planner + 25 executor + 258 API + 236 web; eval 165; typecheck, build, quét bản build đạt.
  - **`npm run test:browser:v3`:** exit 0, 26/26 ca qua 10 scenario (jira_slack 1/1).
- Điều chưa làm hoặc khác với task card:
  - **Không dùng `key = "…"` trong JQL** như task card gợi ý. JQL báo lỗi 400 khi key không tồn tại, làm hỏng cả lần tìm; đọc thẳng `/issue/{key}` thì key thiếu chỉ là 404. Đổi lại tốn thêm 1 request (thêm 2 nếu key không tồn tại, vì có lần gọi `/myself`).
  - **Ở mốc thi công chưa kiểm với Jira thật.** Nghiệm thu sau merge đã đạt, ghi ở phần reviewer bên dưới.
  - Mô tả tool trong catalog **không đổi**, nên không cần đo lại model vì W3-09.

### Review độc lập và nghiệm thu sau merge (Codex, 04/10/2026)

- Review độc lập snapshot `917b2eb`: **58/58** focused tests, **29/29** native HTTP probes (112 escaping inputs), **6/6** base/head controls, exit0; không có P1/P2 được xác nhận. Không sửa source khi review.
- Sau #64, cập nhật branch theo main: head `971c3b25966d4b334b0f4db1d4b746088716278b`, [CI v3](https://github.com/VinhDat267/ATI_Project/actions/runs/37191633127) SUCCESS. Tree bằng snapshot kết hợp được root chạy lại; merge `f284b1215c6b858a34aebf994b5f0b08a4236aed` giữ cùng tree (`git diff --exit-code` đạt).
- Canonical root: check **1.096 v3** = 47 schema + 340 adapters + 180 planner + 25 executor + 258 API + 246 web; **165 offline eval**, typecheck/build/security scan/launcher/guards đạt, exit0. Browser **26/26**, 10 scenario, PostgreSQL tạm55533.
- **Jira thật sau merge:** helper ngoài repo gọi đúng `run.ts check` trong child process, env chỉ bật Jira/project thử ATIT và token giả: **exit1, AUTH_ERROR** đúng kỳ vọng. `checkLiveService` với token giả cũng AUTH_ERROR. Token hiện có: `jira.search_issues(query='W3-07')` trả issue `ATIT-4`; query key `ATIT-4` cũng trả đúng issue. Helper toàn bộ **PASS, exit0**; chỉ GET và POST read-only `/search/jql`, guard chặn ghi. Không in token/site/email hoặc response đầy đủ, không sao chép `.env`.
- Không gọi model, live SMTP, service write hoặc deploy. Log/probe raw giữ ngoài repo; reviewer cập nhật CURRENT-STATE/ROADMAP trong PR tài liệu sau merge.
