# W3-10 · Yêu cầu chỉ đọc hỏi lại ngay; giảm thời gian tới plan preview

**Trạng thái:** chờ · **Nhánh gợi ý:** `fix/w3-10-read-only-latency` · **Phụ thuộc:** không; nên merge trước 20/10 để W4-04 đo trên planner cuối cùng · **Cần gọi model thật:** `ag/gemini-3.8-flash` qua 9router, cùng model với W3-06 để so trước/sau. Không dùng model dự phòng `cx/` của [W4-00](W4-00-llm-fallback-provider.md) cho phép đo này.

Nguồn: phân tích `report.json` của W3-06 ([services](../../ai-evidence/V3-GOLDEN-V2/services-llm-2026-10-03T11-10-25-012Z/summary.md), source `7ba60ef`, 03/10/2026), Claude Code thực hiện ngày 05/10/2026.

## Vấn đề

Đặc tả đặt chỉ tiêu thời gian tới plan preview dưới 15 s. Bộ services (44 câu × 3 lần) có p95 31,1 s, max 53,0 s; 25/132 lượt quá 15 s. Core và freeform cùng ngày có p95 khoảng 13,1 s.

| Nhóm câu (services) | Lượt | p50 | p95 | Quá 15 s |
|---|---|---|---|---|
| read_only | 18 | 25,4 s | 53,0 s | 18 |
| single_step | 57 | 4,6 s | 20,2 s | 4 |
| clarification | 15 | 7,2 s | 41,1 s | 2 |
| refusal | 15 | 4,6 s | 18,1 s | 1 |
| cross_service | 27 | 7,7 s | 10,9 s | 0 |

Hai nguồn chậm tách được:

1. **Yêu cầu chỉ đọc** (sh01, sh07, ca01, no01, tg01, ji01):
   - cả 18 lượt gọi model 3 lần (2 vòng tra cứu rồi 1 câu trả lời);
   - 15 lượt kết thúc bằng từ chối; 3 lượt (sh07 lần 1 và 3, ca01 lần 1) trả plan chỉ có bước đọc, validator vẫn chấp nhận;
   - prompt (`packages/planner/src/prompts/system-prompt.ts`) dặn plan chỉ chứa tool ghi, nhưng `packages/planner/src/validator.ts` không kiểm `sideEffect`.
2. **Đuôi chậm của các câu còn lại:**
   - bỏ nhóm chỉ đọc, p95 còn 18,4 s (7 lượt quá 15 s);
   - 6/7 lượt đó rơi vào lần chạy thứ 2: ca04 41,1 s, no07 44,7 s, ca08 27,0 s, sh06 20,2 s, ji07 18,4 s, no05 18,1 s;
   - cùng các câu đó ở lần 1 và 3 chỉ mất 4–10 s, trừ ca04 (31,1 s và 14,2 s).

   Báo cáo hiện không đủ dữ liệu để phân biệt model suy luận lâu với cổng LLM chậm hay quá hạn:
   - `CountingProvider` (`evaluations/golden-v2/run.ts`) đếm lời gọi `generatePlan`, không đếm lần thử lại bên trong;
   - `callWithRetry` (`packages/planner/src/providers/transport.ts`) cho mỗi lần thử 30 s và thử lại 1 lần khi quá hạn, nên một "lời gọi" có thể gồm 30 s mất trắng cộng một lần thử mới (ca04 lần 2: 41,1 s, ghi 1 lời gọi);
   - không ghi token hay thời điểm của từng lời gọi.

## Quyết định đã chốt (người dùng, 05/10/2026)

Yêu cầu chỉ đọc được **hỏi lại ngay** ở lời gọi model đầu tiên, không tra cứu: hỏi người dùng muốn làm gì với dữ liệu, ví dụ gửi lên Slack, ghi vào Sheets hay tạo card. Plan phải có ít nhất một bước ghi. Không thêm kiểu trả lời đọc dữ liệu, không cho phép plan chỉ đọc.

## Việc cần làm

### A. Đo đủ để biết thời gian đi đâu (làm trước phần B, C)

1. Ghi cho **từng lời gọi model** trong một lượt:
   - thời điểm bắt đầu, tính từ đầu lượt, và thời lượng;
   - số lần thử, lý do thử lại (quá hạn, 429/5xx);
   - model được phục vụ;
   - token prompt/completion, kèm reasoning nếu cổng trả về. Cổng hiện tại gộp reasoning vào `prompt_tokens`, xem `evaluations/README.md` mục "Planning latency".

   Ghi thêm thời gian prefetch thư mục và từng vòng tra cứu.
   - Kiểu trả về của `LLMProvider.generatePlan` và hành vi sản phẩm giữ nguyên. Số liệu đi qua kênh phụ, như `lastServedModel` đang làm.
   - Không ghi nội dung prompt, khóa API hay header.
2. `run.ts` đưa các số liệu này vào `report.json`. `summary.md` thêm: phân bố số lần thử, số lần quá hạn, tỉ lệ thời gian của model, tra cứu và phần còn lại.
3. Test: provider giả quá hạn ở lần thử đầu rồi thành công thì báo cáo ghi 2 lần thử và 1 lần quá hạn. Quá hạn phải dùng `AbortSignal` thật, như test transport hiện có.

### B. Yêu cầu chỉ đọc

4. Prompt: khi yêu cầu không có hành động ghi nào, trả `clarification` ngay, không gửi yêu cầu tra cứu. Câu hỏi gợi ý vài hành động ghi hợp với các service đã được định tuyến.
5. Validator từ chối plan không có bước ghi nào. Planner đổi lỗi này thành một câu hỏi làm rõ cố định bằng tiếng Việt, **không** tốn thêm lời gọi sửa plan.

   Plan vừa đọc vừa ghi giữ hành vi hiện tại. PR ghi rõ validator có chặn bước đọc trong plan hay không, và vì sao.
6. Test planner:
   - plan chỉ đọc thành clarification, số lời gọi model không tăng;
   - plan có bước ghi giữ nguyên hành vi;
   - ba plan chỉ đọc mà W3-06 đã chấp nhận (sh07 lần 1 và 3, ca01 lần 1, lấy nguyên văn từ `report.json`) nay thành clarification.

### C. Label và đo lại

7. **Commit riêng, trước mọi lời gọi model của task này:** sửa label 6 câu read_only trong `evaluations/golden-v2/cases-services.json` theo chính sách mới.
   - Giữ `kind: clarification`. Bỏ yêu cầu phải có tra cứu thành công, và sửa assertion tương ứng trong `cases-services.test.ts`.
   - Không đổi câu prompt.
   - Commit message nêu lý do: chính sách sản phẩm đổi theo quyết định ngày 05/10, không phải để khớp kết quả.
   - Báo cáo nêu rõ mẫu số điểm tool/argument theo service thay đổi, vì 6 câu này không còn bước tra cứu được chấm.
8. Từ số liệu phần A, chọn cách xử lý đuôi chậm và ghi bằng chứng cho lựa chọn đó.
   - Hướng có thể cân nhắc:
     - thời hạn mỗi lần thử ngắn hơn, nếu số liệu cho thấy lần thử sau thường nhanh;
     - giảm suy luận dài, như đã làm với cs11;
     - chạy thêm một lượt `EVAL_CONCURRENCY=1` để kiểm có phải tranh chấp ở cổng;
     - đối chiếu với log hoặc bảng điều khiển của 9router (nếu có): 9router chia request cho nhiều tài khoản Gemini, nên đuôi chậm có thể do 429 hay chuyển tài khoản ở phía 9router, không thấy được từ phía planner.
   - README ghi đã thử và không có lợi: request hedging, biến thể thinking của model.
   - Không đổi catalog tool.
9. Đo lại đủ ba bộ (core 50, freeform 18, services 44), mỗi bộ 3 lần, cùng model, cùng `PLANNER_SEARCH_MODE=llm` và `EVAL_CONCURRENCY=2` như W3-06.
   - Lần đo này thay cho phép đo lại còn nợ sau FE-03, W3-08 và W3-00b.
   - Cổng lỗi giữa chừng thì giữ báo cáo dở dang riêng, như W3-06.
10. Cập nhật `evaluations/README.md`:
    - bảng trước/sau theo nhóm câu;
    - phân rã thời gian;
    - phần trăm lượt dưới 15 s.

## Tiêu chí nghiệm thu

- [ ] Test mới fail trước khi sửa, rồi đạt. `npm run check` exit 0; `npm run test:browser:v3` đạt.
- [ ] Commit sửa label có trước commit chứa báo cáo model đầu tiên của task (chứng minh bằng `git log`).
- [ ] Báo cáo có số lần thử, số lần quá hạn, token và thời lượng từng lời gọi; không chứa khóa hay nội dung prompt.
- [ ] Sáu câu read_only: kind clarification, đúng một lời gọi model, không tra cứu, ở cả 3 lần chạy. Lượt nào chưa đạt thì ghi rõ và giải thích.
- [ ] Core và freeform không giảm strict pass so với W3-06 (150/150, 51/54); câu nào giảm phải được phân tích nguyên nhân.
- [ ] Mục tiêu p95 services dưới 15 s. Nếu chưa đạt: báo cáo nguyên nhân bằng số liệu phần A, không tuyên bố đạt chỉ tiêu.

## Ngoài phạm vi

- Kiểu trả lời đọc dữ liệu; plan chỉ đọc.
- ff15 (Slack/Telegram khi cùng có frontend) và fixture Trello member sai schema: giữ là vấn đề đã biết ở CURRENT-STATE mục 5.
- Đo qua frontend (W4-04).

## Kết quả (agent thi công điền)

- PR: [#102](https://github.com/VinhDat267/ATI_Project/pull/102), **draft, chưa nghiệm thu**; nhánh `fix/w3-10-read-only-latency`, worktree riêng từ `main` `8155c03` (đã có #98–#100). Không merge.
- Commit sửa label: `795229e24c64a38902e7efdce0680c729f37348a`, lý do chính sách sản phẩm chốt 05/10; đúng sáu case chỉ bỏ `expect.searches`, 44/44 prompt không đổi. Commit A/B `7bec3d0` → label `795229e` → chuẩn hóa test `2c47eb9`; **0 lời gọi model thật**, chưa có commit báo cáo model.
- Kết quả: A/B và mục 7 đã thi công. Kênh phụ `lastCallMetrics` có offset/duration từng call và từng attempt, HTTP/retry/timeout, served model và token nullable; `generatePlan` vẫn trả `Promise<string>`. Runner có thời gian directory/search round và phân rã summary, public error không chép nội dung provider. Prompt yêu cầu chỉ đọc hỏi lại ngay; directory chạy sau search đầu tiên để clarification không tra cứu. Validator chặn plan không có bước ghi trước grounding; fixed clarification tiếng Việt không tốn lượt sửa. **Không cấm từng bước đọc trong plan có ghi**, giữ hợp đồng mixed read/write hiện tại. Không đổi catalog, frontend hoặc production API; sáu fixture test chat-api được chỉnh tối thiểu thành search → plan, giữ SQL/HTTP/grounding.
  - RED A 2 fail/5 pass; RED summary/privacy 2 fail/7 pass; RED B 10 fail/1 pass; RED label 1 fail/29 pass, đều exit1. GREEN offline376/376; regression11/11; eval typecheck exit0. `npm run check` exit0 (**1418 v3 + 169 eval**); `npm run test:browser:v3` exit0 (**61/61, 11 scenario**), PostgreSQL tạm riêng postgres16/tmpfs/cổng55533, sandbox, tài khoản ứng dụng CI; không dùng dev15433.
  - Bằng chứng: [W3-10-VERIFICATION](../../ai-evidence/V3-GOLDEN-V2/W3-10-VERIFICATION.md); bảng baseline/NOT_RUN và mẫu số mới tại `evaluations/README.md`; [log bàn giao](../log/2026-10-07-codex-W3-10.md).
- Điều chưa làm hoặc khác với task card: GET `/v1/models` qua cấu hình LLM nạp từ `.env` gốc bằng `--env-file` thất bại `ECONNREFUSED` trên IPv4/IPv6 cổng20128. Đã dừng đo theo yêu cầu; không khởi động/sửa 9router hay đổi model/tài khoản. **Core50×3, freeform18×3, services44×3 và concurrency1 NOT_RUN**. Chưa xác minh read_only18/18 đúng1call/0search, parity150/150 và51/54, p95services<15s; chưa có dữ liệu để chọn cách xử lý đuôi chậm, giữ deadline/retry. README có bảng trước/sau và phân rã với ô sau đo NOT_RUN; không tuyên bố đạt latency. Legacy regex gather giữ thứ tự cũ, fallback no-write áp dụng cả hai mode; immediate no-search là protocol llm. Chờ 9router được người dùng chạy, phép đo đúng model `ag/gemini-3.8-flash` và Claude Code review độc lập.
