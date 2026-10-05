# W4-00 · Đường LLM dự phòng: chuyển sang Codex (`cx/`) trong 9router

**Trạng thái:** chờ · **Nhánh gợi ý:** `chore/w4-00-llm-fallback` · **Phụ thuộc:** không; nên xong trước các phép đo chính thức của tuần 4 (W4-01, W4-03, W4-04) và trước khi dựng môi trường demo tuần 5 · **Có phần việc nhỏ của con người**

## Vấn đề

Mọi phép đo và buổi demo đang dùng 9router chạy ở máy nhóm trưởng (`LLM_BASE_URL=http://localhost:20128/v1`) với model `ag/gemini-3.8-flash`. 9router gom nhiều tài khoản Gemini chạy song song, nên một tài khoản hết quota hay bị khóa không làm hỏng đường chính.

Vẫn còn hai kiểu sự cố mà nhiều tài khoản không chặn được:
- **sự cố của chính 9router:** ngày 03/10, một campaign W3-06 dừng ở 79/132 lượt khi tiến trình cổng đổi;
- **nguồn Gemini phía sau gặp sự cố chung** cho mọi tài khoản.

Chưa có đường thay thế nào được kiểm với sản phẩm. Gemini API chính thức đã thử ngày 29–30/09 (commit `4786fd1`): 503 liên tục và quota miễn phí 20 request/ngày, không dùng được.

## Quyết định đã chốt (người dùng, 05/10/2026)

- Đường chính giữ `ag/gemini-3.8-flash` qua 9router, nhiều tài khoản Gemini.
- Đường dự phòng là **một model Codex (`cx/`) trong cùng 9router**: giữ `LLM_PROVIDER=openai-compatible` và `LLM_BASE_URL`, chỉ đổi `LLM_MODEL`.
- Chuyển **thủ công** rồi khởi động lại. **Không** dùng cơ chế tự chuyển model của 9router: `OpenAICompatibleProvider` từ chối câu trả lời do model khác với model đã cấu hình phục vụ (`packages/planner/src/providers/openai-compatible-provider.ts:94`), và cơ chế đó là đổi model ngầm.
- Codex là họ model khác (GPT, không phải Gemini), nên số liệu không so sánh trực tiếp với các lần đo trước. Mọi báo cáo ghi rõ model.

## Chuẩn bị của người dùng

1. Xác nhận nguồn `cx/` trong 9router đang đăng nhập và gọi được. Danh sách model hiện có trên 9router (ảnh người dùng gửi 05/10): `cx/gpt-6.1-sol`, `cx/gpt-6-astra`, `cx/gpt-6-sol`, `cx/gpt-6-luna`, `cx/gpt-5.6-sol`, `cx/gpt-5.6-terra`, `cx/gpt-5.6-luna`, `cx/gpt-5.5`, cùng các biến thể `[1m]`, `-review` và vài model đặc biệt.
2. Cho biết giới hạn sử dụng của tài khoản Codex nếu biết. Mọi lời gọi của mục 3 và 4 tốn quota của tài khoản này.

## Việc cần làm

1. **Chọn model bằng probe, không đoán theo tên.**
   - Loại các biến thể `[1m]` (ngữ cảnh mở rộng, không cần), `-review`, `codex-auto-review`, `gpt-reserve`, `gpt-daybreak-*`.
   - Chọn 2–3 ứng viên, chạy cùng một bộ nhỏ (`EVAL_ONLY` vài câu core và services, gồm cả câu cần tra cứu, 1 lần).
   - So JSON hợp lệ, strict pass, thời gian mỗi lời gọi. Ghi lý do chọn.
2. **Tương thích qua 9router**, kiểm trên model đã chọn:
   - `response_format: { type: "json_object" }` cho ra JSON đúng `PlannerResponse`;
   - kiểm tra served model đạt. `baseModel` chỉ bỏ tiền tố đầu `cx/`; nếu 9router trả tên khác (thêm hậu tố, đổi tiền tố) thì sửa kèm test, nhưng không nới tới mức chấp nhận một model khác;
   - lỗi 429/5xx được thử lại trong giới hạn;
   - thời gian mỗi lời gọi so với thời hạn 30 s của `transport.ts`. Chỉ ghi lại; đổi thời hạn thuộc W3-10.
3. **Cách chuyển, không sửa `.env` chính.** Node không cho `--env-file` ghi đè biến đã có trong môi trường, nên đặt `LLM_MODEL` trước khi chạy là đủ, ví dụ bash `LLM_MODEL=cx/<model> npm run up`, PowerShell `$env:LLM_MODEL='cx/<model>'; npm run up`. Kiểm điều này với cả `npm run up` và `evaluations/golden-v2/run.ts`, ghi lệnh chuyển và lệnh quay lại.
4. **Đo chất lượng tối thiểu** trên model đã chọn: core 50 và services 44, mỗi bộ **1 lần**, `PLANNER_SEARCH_MODE=llm`, label không đổi.
   - Báo cáo riêng, ghi rõ model; không trộn với số liệu của `ag/gemini-3.8-flash`.
   - Quota không đủ thì chạy ít hơn và ghi rõ đã bỏ phần nào.
5. **Qua sản phẩm:** khởi động `RUNTIME_MODE=live` với model `cx/`.
   - Log khởi động in provider và model (`apps/chat-api/src/server.ts`); chụp lại dòng này.
   - Gửi một câu chat qua giao diện tới preview rồi **Hủy**. Dùng harness `evaluations/live-app/` nếu W3-11 đã merge; nếu chưa, thao tác tay và chụp ảnh. Không ghi ra service.
6. **Runbook** trong `evaluations/README.md`, gồm:
   - dấu hiệu cần chuyển: lỗi model liên tiếp ở đường chính;
   - lệnh chuyển và lệnh quay lại;
   - cách xác nhận model đang chạy;
   - giới hạn quota đã biết;
   - dữ liệu gửi qua nguồn `cx/`: câu chat, tên tài nguyên trong workspace, kết quả tra cứu.

## Tiêu chí nghiệm thu

- [ ] Có bảng probe của các ứng viên và lý do chọn model.
- [ ] Model đã chọn: JSON hợp lệ và served model đúng như cấu hình. Thay đổi code (nếu có) có test RED rồi GREEN; `npm run check` exit 0.
- [ ] Bộ đo tối thiểu chạy xong (hoặc ghi rõ phần chưa chạy và lý do); báo cáo tách riêng, có tên model.
- [ ] App live chạy với model `cx/` tới preview, đã Hủy; không có dòng nào trong `execution_steps`.
- [ ] Chuyển qua lại không cần sửa `.env` chính; runbook có lệnh cho cả bash và PowerShell.
- [ ] Không có khóa hay token trong PR, log, báo cáo.

## Ngoài phạm vi

- Provider ngoài 9router. Rủi ro còn lại khi chính 9router hỏng được ghi trong runbook, không xử lý trong task này.
- Tự chuyển model khi lỗi; Gemini API chính thức.
- So sánh chi tiết chất lượng giữa Gemini và Codex.

## Kết quả (agent thi công điền)

- PR:
- Model đã chọn và bảng probe:
- Kết quả bộ đo:
- Điều chưa làm hoặc khác với task card:
