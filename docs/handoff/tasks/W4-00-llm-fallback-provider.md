# W4-00 · Đường LLM dự phòng qua một provider OpenAI-compatible khác

**Trạng thái:** chờ · **Nhánh gợi ý:** `chore/w4-00-llm-fallback` · **Phụ thuộc:** không; nên xong trước các phép đo chính thức của tuần 4 (W4-01, W4-03, W4-04) và trước khi dựng môi trường demo tuần 5 · **Có phần việc của con người**

## Vấn đề

Mọi phép đo và buổi demo đang dựa vào một cổng tương thích OpenAI chạy ở máy nhóm trưởng (`LLM_MODEL=ag/gemini-3.8-flash`). Cổng có thể ngừng bất cứ lúc nào: ngày 03/10, một campaign W3-06 đã dừng ở 79/132 lượt khi tiến trình cổng đổi.

Gemini API chính thức đã được thử ngày 29–30/09 (commit `4786fd1`): 503 liên tục và quota miễn phí 20 request/ngày cho `gemini-3.8-flash`, không đủ cho đo hay demo.

## Quyết định đã chốt (người dùng, 05/10/2026)

- Đường dự phòng dùng **một provider khác qua `OpenAICompatibleProvider` sẵn có** (`packages/planner/src/providers/openai-compatible-provider.ts`), ví dụ OpenRouter. Không dùng Gemini API chính thức.
- Chuyển provider **thủ công** bằng cấu hình rồi khởi động lại. **Không** tự chuyển khi cổng lỗi: như vậy là đổi model ngầm, trái với lớp kiểm tra served model hiện có.
- Model khác thì số liệu không so sánh trực tiếp với các lần đo trước. Mọi báo cáo phải ghi provider và model.

## Chuẩn bị của người dùng (agent không tự làm)

1. Chọn provider, tạo tài khoản và API key, đặt giới hạn chi tiêu trên trang của provider.
2. Chọn model: ưu tiên đúng `gemini-3.8-flash` nếu provider có, nếu không thì một model cùng họ Gemini Flash. Báo agent tên model chính xác.
3. Điền một file env riêng, không commit (đề xuất `.env.llm-fallback`; `.gitignore` đã bỏ qua `.env.*`): `LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
4. Duyệt ngân sách cho lần đo ở mục 4. Agent ước tính số lời gọi model trước khi chạy.

## Việc cần làm

1. Đọc tài liệu hiện hành của provider đã chọn; ghi tên trang và ngày đọc. Các điểm cần xác định:
   - endpoint `/chat/completions`;
   - model đã chọn có hỗ trợ `response_format: { type: "json_object" }` không;
   - trường `model` trong phản hồi;
   - mã lỗi khi hết quota hoặc bị rate limit;
   - cơ chế tự chuyển model hoặc nhà cung cấp phía provider: phải tắt, hoặc chứng minh không xảy ra.
2. Cách chuyển provider mà không sửa `.env` chính:
   - Node nạp nhiều `--env-file`, file sau ghi đè file trước; `npm run up` hiện chạy `node --env-file-if-exists=.env scripts/start-v3.mjs`;
   - thêm script hoặc hướng dẫn để API (qua `npm run up`) và `evaluations/golden-v2/run.ts` dùng được file dự phòng;
   - `git check-ignore` chứng minh file dự phòng không bị commit;
   - cập nhật `.env.example`: chỉ tên biến và chú thích, không có giá trị.
3. Probe thật: một lời gọi, rồi một bộ nhỏ (`EVAL_ONLY` vài câu core và services, 1 lần). Xác nhận:
   - JSON hợp lệ;
   - kiểm tra served model đạt. `baseModel` hiện chỉ bỏ tiền tố đầu `xxx/`; nếu provider trả tên có hậu tố phiên bản thì sửa kèm test, nhưng không nới tới mức chấp nhận một model khác;
   - lỗi 429/5xx được thử lại trong giới hạn;
   - khóa API không xuất hiện trong log hay thông báo lỗi.
4. Đo chất lượng tối thiểu trên model dự phòng: core 50 và services 44, mỗi bộ **1 lần**, `PLANNER_SEARCH_MODE=llm`, label không đổi.
   - Báo cáo riêng, ghi rõ provider và model; không trộn với số liệu của model chính.
   - Ngân sách không đủ thì chạy ít hơn và ghi rõ đã bỏ phần nào.
5. Qua sản phẩm: khởi động `RUNTIME_MODE=live` với cấu hình dự phòng.
   - Log khởi động đã in provider và model (`apps/chat-api/src/server.ts`); chụp lại dòng này.
   - Gửi một câu chat qua giao diện tới preview rồi **Hủy**. Dùng harness `evaluations/live-app/` nếu W3-11 đã merge; nếu chưa, thao tác tay và chụp ảnh. Không ghi ra service.
6. Viết runbook trong `evaluations/README.md`, gồm:
   - khi nào chuyển sang dự phòng;
   - lệnh chuyển và lệnh quay lại;
   - cách xác nhận model đang chạy;
   - giới hạn chi phí;
   - dữ liệu nào được gửi cho provider bên thứ ba: câu chat, tên tài nguyên trong workspace, kết quả tra cứu.

## Tiêu chí nghiệm thu

- [ ] Probe thật: JSON hợp lệ, served model đúng model đã cấu hình, khóa API không có trong output.
- [ ] Bộ đo tối thiểu chạy xong (hoặc ghi rõ phần chưa chạy và lý do); báo cáo tách riêng, có provider và model.
- [ ] App live chạy với cấu hình dự phòng tới preview, đã Hủy; không có dòng nào trong `execution_steps`.
- [ ] Chuyển qua lại không cần sửa `.env` chính; file env dự phòng bị ignore.
- [ ] Mọi thay đổi code có test RED rồi GREEN; `npm run check` exit 0.
- [ ] Không có khóa API trong PR, log hay báo cáo.

## Ngoài phạm vi

- Tự chuyển provider khi lỗi.
- Gemini API chính thức: giữ code `gemini-provider.ts`, không nghiệm thu.
- So sánh chi tiết chất lượng giữa hai model.

## Kết quả (agent thi công điền)

- PR:
- Provider, model, tài liệu đã đọc:
- Kết quả probe và bộ đo:
- Điều chưa làm hoặc khác với task card:
