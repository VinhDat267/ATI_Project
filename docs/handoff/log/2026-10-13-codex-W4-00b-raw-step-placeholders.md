# 13/10/2026 · W4-00b · Chặn tham chiếu bước trong chuỗi thô

- Ngày: 13/10/2026, Asia/Saigon.
- Task: [W4-00b](../tasks/W4-00b-raw-step-placeholders.md), giao `longnguyen005`.
- Nhánh: `codex/fix-w4-00b-raw-placeholders`; base `3b60c28`.
- Commit mã sản phẩm/test: `22288452d3e3cf57ead2747392ed665a5281fbe9`.
- PR: bổ sung đường dẫn sau khi mở; chưa merge, chờ review độc lập và CI.

## Thay đổi

- `packages/planner/src/validator.ts`: sau kiểm schema từng bước, duyệt đệ quy args (object và array). Chuỗi thường chứa `${<id>.output…}` bị từ chối tại lớp semantic; lỗi nêu đúng bước, đường dẫn tham số, placeholder và cách dùng `$template`/`$ref`. Không tự biến đổi chuỗi.
- Giá trị trong wrapper `$template`/`$ref` giữ validation cũ. `${HOME}`, `$100`, `${{ secrets.X }}`, `.outputLabel` và đường dẫn không có `${…}` vẫn là literal.
- Ngoại lệ kiểm từng placeholder xuất hiện nguyên văn trong `grounding.userTexts`: một placeholder được người dùng gõ không cho phép placeholder khác trong cùng chuỗi. Không chuẩn hóa khoảng trắng, không lấy ngoại lệ từ Working Memory, assistant history hoặc feedback retry.
- `packages/planner/tests/validator.test.ts`: thêm 17 ca với catalog thật, bao gồm `sheets.append_rows.rows[0][1]` và `notion.create_page.properties.Link`.
- `packages/planner/tests/planner.test.ts`: thêm 8 ca chạy qua AIPlanner thật với provider giả trả chuỗi theo lượt, 4 ca cho mỗi chế độ `regex`/`llm`: sửa đúng bằng template ở lần thử lại, từ chối cả hai lần thô, giữ literal từ user history, không giữ literal chỉ có trong assistant history. Grounding tài nguyên bật và dùng ID đã có trong memory.
- Không sửa planner retry, prompt, executor, schema/catalog, label/matcher golden hoặc timeout/retry. Không sửa CURRENT-STATE/ROADMAP.

## RED trước khi sửa

Lệnh `npm test -w @wap/planner -- tests/validator.test.ts tests/planner.test.ts`, exit **1**, sau khi thêm test và trước khi sửa validator:

```text
tests/validator.test.ts (43 tests | 10 failed)
tests/planner.test.ts (46 tests | 6 failed)
Test Files  2 failed (2)
     Tests  16 failed | 73 passed (89)
```

Ví dụ lỗi thực tế: validator `expected true to be false`; planner trả plan chuỗi thô thay vì plan `$template` của lượt thử lại; các ca hai lần thô báo `promise resolved ... instead of rejecting`. Không có lỗi setup/import hoặc grounding làm giả RED.

## GREEN và đột biến

- Cùng lệnh focused sau sửa: exit **0**, `Test Files 2 passed (2)`, `Tests 89 passed (89)`.
- Lệnh mỗi mutation: `npm test -w @wap/planner -- tests/validator.test.ts tests/planner.test.ts -t W4-00b`. Chỉ đổi tạm source validator; luôn khôi phục byte gốc trong `finally` trước gate cuối. Mỗi mutation thật được áp dụng riêng, không thay assertion.

| Đột biến | Output test thật | Exit | Test bắt lỗi |
|---|---|---:|---|
| Bỏ lời gọi kiểm tra mới | 16 failed / 9 passed / 64 skipped | 1 | Chuỗi cấp một, nested, mixed literal; planner nhận plan thô |
| Chỉ duyệt child là string ở cấp một | 2 failed / 23 passed / 64 skipped | 1 | Sheets rows và Notion properties |
| Bỏ ngoại lệ `userTexts` | 4 failed / 21 passed / 64 skipped | 1 | User literal, mixed literal (placeholder lỗi sai), user history trong hai chế độ |

## Gate toàn repo

PostgreSQL 16 chạy trong container riêng `ati-w4-00b-postgres`, cổng `127.0.0.1:56533`, dữ liệu tmpfs. `RUNTIME_MODE=sandbox`, `DATABASE_URL` trỏ đúng DB tạm và `V3_LOCAL_DB_PORT=56533` chỉ được đặt trong tiến trình chạy lệnh; không sửa `.env`, không dùng DB live hoặc volume phát triển.

- `docker exec ati-w4-00b-postgres pg_isready -U ati_v3 -d ati_v3`: exit 0, accepting connections.
- `npm run db:migrate:local:v3`: exit 0, áp dụng đủ 0001–0008.
- `npm run check`: exit **0**:
  - typecheck API/web đạt;
  - 47 schema, 340 adapter, 237 planner, 25 executor, 371 API, 679 web = **1.699 v3**, tất cả pass;
  - **173/173 eval** pass;
  - build đạt; main JS 877,41 kB (gzip 216,08 kB), cảnh báo chunk >500 kB có sẵn;
  - security scan: `PASS: production build excludes credential sentinels and 6 forbidden UI claims`;
  - launcher **1/1**, env/OIDC **10/10** pass.
- `git diff --check`: exit 0.
- Output gốc RED/GREEN, ba mutation và gate giữ trong `.cache/w4-00b/` ignored; các số và trích đoạn cần review ghi ở trên.

## Chưa làm và bàn giao

- **Không chạy** phép đo model/golden thật hoặc Luna tham khảo `EVAL_ONLY=cs03,cs04,ca03,ji03`; task không yêu cầu gate này, nhóm trưởng có thể chạy sau merge bằng 9router. Không thay kết quả golden lịch sử.
- Không chạy browser cục bộ vì thay đổi chỉ ở validator; workflow CI hiện có chạy `npm run check` và toàn bộ browser. Chưa chứng nhận CI hoặc review độc lập tại thời điểm viết log này.
- Đề nghị reviewer chạy lại focused tests, kiểm ngoại lệ user literal và mutation, rồi đối chiếu CI trên đúng head trước merge. Sau merge reviewer cập nhật CURRENT-STATE/ROADMAP.
