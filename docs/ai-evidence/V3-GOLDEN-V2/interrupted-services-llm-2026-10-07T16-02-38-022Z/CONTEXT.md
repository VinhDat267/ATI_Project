# W3-10 — lượt gián đoạn trước xác nhận alias

Source `e8b06c96a1ffc6ae64d5a7dbb54aa32040096890`; label preregister
`795229e24c64a38902e7efdce0680c729f37348a`, chính sách chốt 05/10/2026.
GET `/v1/models` trả HTTP 200, có `ag/gemini-3.8-flash` trước khi đo.

Campaign services, llm, concurrency 2, yêu cầu 44 × 3; exit 2 sau 2/132 lượt.
Lỗi gốc ở sh02: response khai `gemini-3.8-flash-n` nên guard model từ chối.
sh01 đang chạy bị hủy theo lỗi đó; `stopReason` trong report lấy hàng đầu tiên
theo thứ tự case nên ghi cancellation. Report và summary giữ nguyên dữ liệu gốc.

Hai generatePlan, hai transport attempt, không retry/timeout, không search.
sh02 mất 4544 ms (model 4524.406 ms); token prompt/completion/reasoning
4392/32/92. sh01 mất 4588 ms (model 4550.656 ms), token null vì bị hủy.
Không có phản hồi planner được chấp nhận; không dùng campaign này tính parity
hoặc so sánh latency.

Sau khi dừng, người dùng xác nhận `gemini-3.8-flash-n` là tên đúng của model
được yêu cầu. Commit `845701cc153055b395170d871f08f349215320d2` thêm chấp nhận
chỉ alias chính xác này cho request `ag/gemini-3.8-flash`, qua TDD:
RED 1 failed/18 passed, GREEN planner/runner 220/220. Giữ raw servedModel;
vẫn từ chối model khác, suffix khác và alias trên route khác. Đo lại bắt đầu
sau GET models mới HTTP 200; không thay cấu hình hoặc khởi động 9router.
