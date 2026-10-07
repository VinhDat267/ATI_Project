# W3-10 — services gián đoạn sau xác nhận alias

Source `845701cc153055b395170d871f08f349215320d2`; labels
`795229e24c64a38902e7efdce0680c729f37348a`. Request
`ag/gemini-3.8-flash`, response `gemini-3.8-flash-n` theo xác nhận người dùng.
GET models mới HTTP 200 trước đo; llm, concurrency 2, yêu cầu 44 × 3.

Exit 2 sau 35/132 lượt, không có run đầy đủ. Lỗi gốc ji03: attempt error,
không HTTP status, không served model/usage; public error được phân loại chung.
Không đủ dữ liệu phân biệt JSON lỗi với kết nối lỗi. ji02 bị hủy theo lỗi đó.
`stopReason` trong report chọn hàng đầu theo thứ tự case nên ghi cancellation.
GET models sau lỗi vẫn HTTP 200; nó không xác minh endpoint completion đã hồi
phục. Metadata usage của cổng không đủ để gán lỗi/tài khoản cho request này;
không kết luận có 429 hay chuyển tài khoản. Không khởi động/sửa cổng.

32/35 strict; ca04 là lỗi chất lượng model (refusal thay vì clarification),
hai case Jira lỗi/hủy thuộc transport. Sáu read_only đã đi qua ở run1 đều
clarification, đúng 1 generatePlan, 0 search, 0 prefetch; latency
sh01/sh07/ca01/no01/tg01/ji01 = 14194/5673/14413/5939/6803/9535 ms.
Không xác nhận 18/18 hoặc dùng campaign chưa đầy đủ để nghiệm thu parity/p95.

59 generatePlan, 60 attempt; 58 call có 1 attempt, 1 call có 2 attempt;
1 timeout/retry, 0 HTTP transient retry. Model 496134.853 ms (99.9476%),
directory 15.513 ms, search round 3.860 ms, còn lại 240.774 ms trên tổng
496395 ms (cộng thời gian lượt, không phải wall time cả campaign concurrency2).
22/35 dưới 15 s (62.86%); p50/p95/max = 13702/24972/57340 ms, chỉ mô tả
sample bị gián đoạn. ca04: attempt timeout 30013.448 ms rồi success 27321.440 ms,
2577 reasoning token; retry này vẫn lâu hơn 15 s nên chưa có bằng chứng rút
deadline sẽ cải thiện đuôi. sh03: 2 call 5825.61 + 19119.97 ms, call sau
1545 reasoning token; có cả chi phí nhiều vòng và một attempt suy luận lâu.
Giữ deadline/retry; chờ campaign đủ và thử concurrency1 trước khi chọn can thiệp.

## Lọc privacy trước commit

Model chép nguyên prompt tg02 vào `response.summary`. Bản public chỉ thay chuỗi
đó bằng `[redacted case prompt]`; tất cả trường khác, score, timing, arguments,
searches và usage giữ nguyên (đã deep-compare). Summary tổng hợp không đổi.
Không lưu bản chứa prompt trong repository.

- SHA-256 trước lọc: `20e78b46c0a7eddce70d191725cc16d4e99c9a40ee6036e0d3eb970db8c2c2bf`.
- SHA-256 public: `c514216e5c6975413fddecb4406331cf1cb04b99de3ec28db8e74b33eac9a0d6`.
- Exporter `50761b1` xử lý việc model echo prompt sau scoring, không sửa
  phản hồi sản phẩm. RED 2 failed/9 passed; GREEN 382/382 planner+eval, eval
  typecheck exit0. Phân loại JSON lỗi riêng cho lần đo tiếp mà không lộ body.

Core/freeform và các run services còn lại chưa chạy sau lỗi này. Campaign này
được giữ riêng, không ghép các lần chạy thiếu thành một phép đo hoàn chỉnh.
