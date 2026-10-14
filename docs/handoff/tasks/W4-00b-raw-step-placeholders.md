# W4-00b · Validator từ chối tham chiếu bước viết thành chuỗi thô

**Trạng thái:** xong #137 tại `ebc192d` (14/10/2026), `longnguyen005` thi công; review độc lập đạt; phép đo tham khảo với Luna chưa chạy · **Nhánh gợi ý:** `fix/w4-00b-raw-step-placeholders` · **Phụ thuộc:** không · **Mốc:** trước **20/10/2026** (trước buổi thử W4-03 và trước khi diễn tập chuyển sang LLM dự phòng ở tuần 5)
**Nguồn:** review độc lập #133 (W4-00) ngày 13/10/2026, trên bằng chứng gốc W4-00 (`docs/ai-evidence/V3-LIVE-EXECUTION/W4-00-2026-10-12/`, ignored) và các report golden Gemini trong `docs/ai-evidence/V3-GOLDEN-V2/`.

## Vấn đề

Kế hoạch dùng output của bước trước theo hai cách hợp lệ: `{ "$ref": "step_1.output.url" }` hoặc `{ "$template": "Xem ${step_1.output.url}" }` (prompt quy tắc 7, `packages/planner/src/prompts/system-prompt.ts:69`).

Model đôi khi viết thẳng chuỗi thường `"Xem ${step_1.output.url}"`, không bọc trong `$template`.
- **Validator** (`packages/planner/src/validator.ts`) chấp nhận: `validateSchemaValue` chỉ kiểm kiểu `string`; `extractRefs` chỉ đọc `$ref`/`$template`.
- **Executor** (`packages/executor/src/resolver.ts:58–60`) trả nguyên chuỗi thường, không thay giá trị.
- **Hậu quả:** nếu người dùng duyệt, đúng chuỗi `${step_1.output.url}` được gửi lên Slack, Telegram, Jira, Notion hay Sheets. Đây là lệnh ghi thật với nội dung sai và không tự hoàn tác.

## Bằng chứng

Quét các kế hoạch `kind: plan` (đã qua `AIPlanner.processMessage`, tức đã qua validator) tìm chuỗi `${<id>.output…}` không nằm trong `$template`:

| Nguồn | Kế hoạch | Có chuỗi thô |
|---|---:|---:|
| `ag/gemini-3.8-flash`, mọi report golden 29/09 → 08/10 (tính cả các lần chạy lặp) | khoảng 1.850 | 0 |
| `cx/gpt-6.1-sol` (W4-00, model dự phòng đã chọn) | 62 | 0 |
| `cx/gpt-5.6-luna` (W4-00) | 62 | 10 ca |
| `cx/gpt-6-luna` (W4-00) | 61 | 13 ca |

Ví dụ `cx/gpt-5.6-luna` ca `cs04`: tham số `slack.send_message.text` là `"New issue opened for the 500 error on file upload: ${create_issue.output.url}"`. Hai model đang dùng chưa từng sinh lỗi này, nên đây là lỗi tiềm ẩn. Nó lộ ra khi đổi model (W4-00 vừa làm), đổi prompt hoặc khi upstream đổi model ngầm.

## Môi trường

Không cần 9router hay model thật. Test validator đưa kế hoạch JSON viết sẵn vào `validatePlan`; test planner dùng provider giả trả chuỗi theo lượt như các test hiện có trong `packages/planner/tests/`. `npm run check` cần Node và PostgreSQL tạm (Docker), như FE-10/FE-11.

## Việc cần làm

Viết test fail trước, ghi output fail thật, rồi mới sửa.

1. **Validator, lớp semantic:** duyệt đệ quy `args` của mọi bước (cả mảng và object lồng, ví dụ `sheets.append_rows.rows`). Chuỗi thường chứa placeholder dạng `${<id>.output…}` (gợi ý regex `/\$\{\s*[A-Za-z_][\w-]*\.output\b[^}]*\}/`) thì trả `valid: false`, `layer: 'semantic'`.
   - Câu lỗi nêu đúng bước, đường dẫn tham số, và cách sửa: dùng `{ "$template": "..." }` hoặc `{ "$ref": "..." }`. Planner đã có một lượt thử lại kèm câu lỗi (`planner.ts`, quanh dòng 435–477), nên câu lỗi phải đủ để model tự sửa.
   - Giá trị trong `$template` giữ nguyên hành vi hiện tại.
2. **Không chặn nhầm:**
   - chuỗi có `$` hay `${...}` không phải dạng `<id>.output` (ví dụ `${HOME}`, `$100`, `${{ secrets.X }}` của GitHub Actions) vẫn hợp lệ;
   - khi có `grounding.userTexts`, placeholder xuất hiện nguyên văn trong câu người dùng gõ thì giữ (người dùng muốn gửi đúng chuỗi đó). Không có grounding thì vẫn từ chối.
3. Không đổi prompt, executor, label golden hay matcher.

## Test tối thiểu

- `packages/planner/tests/validator.test.ts`:
  - chuỗi thô ở tham số cấp một → từ chối, câu lỗi có tên bước, tham số và `$template`;
  - chuỗi thô trong mảng/object lồng → từ chối;
  - cùng placeholder trong `$template` → hợp lệ;
  - `${HOME}`, `$100`, `${{ secrets.X }}` → hợp lệ;
  - placeholder có trong `userTexts` → hợp lệ; cùng plan không có grounding → từ chối.
- `packages/planner/tests/planner.test.ts` (provider giả trả chuỗi theo lượt, như các test hiện có):
  - lượt đầu có chuỗi thô, lượt thử lại dùng `$template` → trả plan của lượt thử lại;
  - cả hai lượt đều thô → lỗi lập kế hoạch, không trả plan.
- Đột biến, ghi kết quả vào log: bỏ kiểm tra mới; chỉ kiểm tham số cấp một; bỏ ngoại lệ `userTexts`. Mỗi đột biến phải bị ít nhất một test bắt.

## Tiêu chí nghiệm thu

- [ ] Test RED commit riêng (hoặc output fail dán trong log), GREEN sau sửa; đột biến ở trên bị bắt.
- [ ] `npm run check` exit 0.
- [ ] Không đổi prompt, executor, label hay matcher golden.
- [ ] Không bắt buộc đo lại golden: Gemini và `cx/gpt-6.1-sol` có 0 chuỗi thô trong các report trên. Phép đo tham khảo `EVAL_ONLY=cs03,cs04,ca03,ji03` một lần với `cx/gpt-5.6-luna` (xem lượt thử lại sửa được bao nhiêu) cần 9router ở máy nhóm trưởng: người thi công ghi "không chạy" trong log; nhóm trưởng chạy sau merge. Không phải gate.

## Ngoài phạm vi

- Executor tự hiểu `${...}` trong chuỗi thường: làm vậy thì chuỗi người dùng gõ có `${...}` bị thay ngầm (lỗi #111 đã sửa ở FE-06A theo hướng ngược lại).
- Đổi prompt để model ít viết chuỗi thô.

## Kết quả (agent thi công điền)

- PR: [#137](https://github.com/VinhDat267/ATI_Project/pull/137), nhánh `codex/fix-w4-00b-raw-placeholders`, base `3b60c28`; mã sản phẩm và test `2228845`. Chờ review độc lập/CI, chưa merge.
- RED/GREEN và đột biến: test viết trước sửa, RED **16 fail / 73 pass**, exit 1; GREEN **89/89**, exit 0. Thêm 25 ca dùng catalog thật và provider giả, kiểm cả hai chế độ `regex`/`llm`, không coi assistant history hoặc feedback thử lại là câu người dùng. Ba mutation bị bắt: bỏ kiểm tra mới **16 fail / 9 pass**; chỉ kiểm cấp một **2 fail / 23 pass**; bỏ ngoại lệ `userTexts` **4 fail / 21 pass**; cả ba exit 1, 64 ca ngoài W4-00b được lọc bỏ. Validator được khôi phục nguyên bản trước gate cuối.
- Gate: `npm run check` exit 0, **1.699 v3 + 173 eval** (47 schema + 340 adapter + 237 planner + 25 executor + 371 API + 679 web); typecheck, build, security scan, launcher 1/1 và env/OIDC 10/10 đạt. PostgreSQL 16 tạm riêng tại loopback cổng 56533, không dùng dữ liệu live hoặc volume phát triển.
- Điều chưa làm hoặc khác với task card: không đổi prompt, executor, label/matcher golden, `CURRENT-STATE.md` hoặc `ROADMAP.md`. Không chạy model/golden thật hoặc phép đo Luna tham khảo; nhóm trưởng có thể chạy sau merge theo card, không phải gate. Chưa chạy browser cục bộ; CI sẽ chạy bộ browser hiện có. Chờ review độc lập trước nghiệm thu/merge. Xem [nhật ký và output RED/GREEN](../log/2026-10-13-codex-W4-00b-raw-step-placeholders.md).
