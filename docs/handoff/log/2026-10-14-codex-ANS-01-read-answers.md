# 14/10/2026 · ANS-01 · Trả lời câu chỉ đọc sau cờ

- Ngày: 14/10/2026, Asia/Saigon; task [ANS-01](../tasks/ANS-01-read-answers.md), giao `longnguyen005`.
- Nhánh `codex/feat-ans-01-read-answers`, base `61d3be4`, mã/test `77676a1d68d88d127669aedfd477b9021f17882a`.
- PR: bổ sung sau khi mở. Chưa merge, chờ review độc lập.

## Thay đổi

- Hợp đồng `AnswerLookup`/`AnswerResponse` ở tool-schemas đúng GMAIL-common 4.5. Không đổi catalog, executor, scorer hoặc label golden. Các nhánh evaluations hiện có đã phân biệt `plan`, nên kiểu mới không gây lỗi và chưa được chấm điểm.
- `validateAnswer` từ chối khi cờ tắt, text sai kiểu/rỗng/dài hơn 4000 hoặc không có dữ liệu đọc trong lượt này. Metadata do model tự khai bị bỏ.
- `AIPlanner.readAnswers` mặc định false, chỉ dùng trong vòng `llm`. Prompt on hướng dẫn đọc rồi trả JSON answer; prompt/search envelope off giữ từng byte. Planner ghi riêng các tra cứu model yêu cầu thành công và các dịch vụ prefetch thành công; chỉ metadata từ các lần gọi này đi vào answer. Empty result là một lần đọc thành công; memory cũ và các lần đọc lỗi không làm `hasReadData` thành true.
- Link chỉ lấy từ trường `url` trong dữ liệu đã đọc, bắt đầu bằng https, bỏ trùng và tối đa 5/lần gọi. `query` chỉ lấy khi args.query là string. Text sai thì sửa một lần; vẫn sai thì câu hỏi `read_only` cũ. Kế hoạch vẫn cần bước ghi.
- `PLANNER_READ_ANSWERS=on/off`, mặc định off; server truyền cờ vào planner, `.env.example` ghi off. Không sửa `.env` của người dùng.
- ChatService lưu assistant/type answer, lookups/usedDirectory/correlation; SSE answer rồi idle. Không tạo plan hoặc execution cho câu trả lời. Lịch sử bọc `<previous_answer>` với câu tiếng Anh phân biệt dữ liệu và chỉ dẫn, cùng ngôn ngữ của search envelope; giữ cách bỏ `connections` khỏi lịch sử plan của GMAIL-01.
- Web nhận SSE/hydration qua metadata, khoảnh khắc answer và màn theo Responses/design system. Văn bản là text node pre-wrap; chỉ các link nguồn https thành liên kết, target blank và rel noopener noreferrer; accordion aria-expanded; nguồn tra cứu/danh mục và câu chưa ghi gì; một composer, lượt tiếp theo tạo plan bình thường. Dữ liệu read_only cũ giữ nguyên.
- Reload answer không cho preview cũ hoặc receipt an toàn chiếm màn. Trạng thái unknown/reconciliation vẫn được selector ưu tiên. Sandbox answer dùng context từng hội thoại để trả search → answer → follow-up plan, không dùng bộ đếm chung cho nhiều người.
- Runner browser thêm nhóm answer sau 11 nhóm cũ; chỉ nhóm này bật cờ và chế độ llm. Không đổi assertion, timeout hoặc retries của test cũ.

## TDD và mutation

Test được thêm và chạy trước phần sửa tương ứng. Output thật trong `.cache/ans-01/` ignored.

```text
Planner RED: Test Files 1 failed; Tests 14 failed | 2 passed (16); exit 1
API RED:     Test Files 1 failed; Tests 2 failed (2); exit 1
Web RED:     Test Files 1 failed; Tests 5 failed | 1 passed (6); exit 1
Reload RED:  Tests 1 failed | 5 skipped (6); exit 1
```

- Planner RED có các ca lookup → answer và retry sai, không chỉ lỗi thiếu export validator. API RED trên PostgreSQL thật: không có tin answer được lưu và cờ chưa có. Web RED: chưa hiển thị answer. Reload RED bổ sung: preview cũ chiếm màn.
- Lệnh focused: `npm test -w @wap/planner -- tests/read-answers.test.ts`, `npm test -w @wap/chat-api -- tests/services/read-answers.test.ts`, `npm test -w @wap/chat-web -- tests/read-answers.test.tsx`. GREEN cuối: **17/17**, **2/2**, **6/6**, mọi lệnh exit 0. Planner gồm AbortSignal thật: Slack prefetch hoàn tất, Calendar chạm budget, chỉ Slack được ghi vào usedDirectory.
- `npm test -w @wap/planner -- tests/read-answers.test.ts tests/read-only-policy.test.ts` ở mốc trước thêm ca AbortSignal: **27/27**, exit 0.

| Mutation thật | Output | Exit |
|---|---|---:|
| Bỏ yêu cầu dữ liệu đọc | 3 failed / 14 passed | 1 |
| Dùng lookups model tự viết | 2 failed / 15 passed | 1 |
| Dựng dangerouslySetInnerHTML cho text | 2 failed / 4 passed | 1 |
| Không bọc answer trong lịch sử | 1 failed / 1 passed | 1 |
| Cờ off vẫn nhận answer | 1 failed / 16 passed | 1 |

Mỗi mutation được áp dụng riêng rồi chạy đúng test workspace; `finally` khôi phục byte gốc trước gate. Không sửa assertion để bắt mutant.

## Gate và môi trường

- PostgreSQL 16 tmpfs riêng `ati-ans01-postgres`, loopback 56533, DB ati_v3. Shell chạy sandbox, DATABASE_URL tạm, V3_LOCAL_DB_PORT=56533, account browser tổng hợp; cả hai cờ off trong gate chung. Không dùng DB live, không đụng volume phát triển.
- Migration **0001–0009** và admin provisioning local exit 0.
- `npm run check` cuối exit **0**: **1.836 v3** (63 + 340 + 257 + 36 + 455 + 685) **+ 173 eval**, typecheck, build, security scan `PASS: production build excludes credential sentinels and 6 forbidden UI claims`, launcher 1/1, env/OIDC 10/10 đạt.
- Hai lượt check đầu cùng source exit 1: mỗi lượt 3 test API cũ fail HTTP500/missing response. Log DB tại cùng thời điểm có `FATAL: sorry, too many clients already` (max_connections=100). Lượt 1: auth-sessions CAS, Notion/Sheets extension; lượt 2: auth-sessions CAS, Calendar extension, service-check-generation. Tái tạo đúng container riêng với **max_connections=200**, migration/provision lại rồi full check đạt. Không thay source/config product, concurrency assertion, timeout hay retries. CI Ubuntu giữ cấu hình hiện có.
- Browser answer focused: lệnh Playwright config hiện có, grep `ANS-01:`, **4/4**, exit 0, 1440/375 sáng/tối. Kiểm screenshot, text HTML/URL nguyên văn, link nguồn, reload, follow-up plan pending và SQL 0 execution steps.
- Hai lượt browser mới đầu chưa đạt vì test dùng nhãn nút Gửi yêu cầu sau khi chuyển sang composer Responses (thực tế Gửi tin nhắn), rồi tiêu đề fallback Kiểm tra trước khi làm thay vì tiêu đề bản React Tôi sẽ làm 1 việc, theo thứ tự. Đã sửa locator/expected title của test mới theo DOM; không đổi assertion nhóm cũ hoặc thêm timeout/retry. Các bước tra cứu, lưu và reload đã đạt trong cả hai lượt thất bại này.
- `npm run test:browser:v3` exit **0**, **105 pass / 1 skip có chủ đích** qua đủ **12 nhóm**: default 83 pass/1 skip, auth02 2, auth04 6, clarification 2, partial_failure 2, sáu nhóm workflow dịch vụ 6, answer 4. Nhóm answer 1440/375 sáng/tối kiểm qua app thật, reload và follow-up write plan pending; không bấm duyệt hoặc gọi service thật.
- Build main JS **880,59 kB**, gzip **216,89 kB**; cảnh báo chunk >500 kB có sẵn vẫn còn, ngoài phạm vi task.
- `git diff --check` exit 0. Đối chiếu diff evaluations/executor/catalog export/CURRENT-STATE/ROADMAP rỗng.

## Ảnh và giới hạn

Ảnh focused giữ tại `.cache/ans-01/screenshots/` ignored, đã xem trực tiếp mobile sáng/tối; không tràn ngang, text nguyên văn, composer không che nội dung.

| Ảnh | SHA256 |
|---|---|
| answer-1440-dark.png | BEBA8D7A50F01E8879EF3D9A24B78F43EF5E8879D7269898ADD5062DEC0F4D49 |
| answer-1440-light.png | 1F57A95E43E801ACAA6B45D13D7B654973D79F0B914522734A03750AF86F5361 |
| answer-375-dark.png | F120DC6368692D01A7A254CC20519DE17B99E610BA1D2A7E0B08BF9F138811A2 |
| answer-375-light.png | 9C020F17FF2DB93327FF335ABBDE39963BB4B577153DF25DB43A995BB02C436D |

- **Không chạy** model thật, 9router hoặc golden thật; GMAIL-04 đo phần answer, không đổi label/scorer cũ ở task này.
- Cờ vẫn off mặc định, không bật trên máy buổi thử W4-03. Chưa chứng nhận chất lượng tóm tắt của model; nguồn thật chỉ chứng minh đã đọc dữ liệu, không chứng minh mọi câu model nói là đúng.
- Chưa merge hoặc review độc lập. Reviewer chạy lại focused/SQL/browser, kiểm metadata và chốt reload, đối chiếu CI đúng head trước merge; chỉ reviewer cập nhật CURRENT-STATE/ROADMAP sau merge.
