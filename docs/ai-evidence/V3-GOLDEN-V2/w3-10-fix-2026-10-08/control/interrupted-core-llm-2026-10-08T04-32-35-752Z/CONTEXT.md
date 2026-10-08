# Đối chứng core gián đoạn — 08/10/2026

- Nhánh tạm chỉ dùng local: `VinhDat267/w3-10-control-8155c03`, base `8155c03`, head `7898aa7`.
- Cherry-pick `845701c` chỉ giữ thay đổi chấp nhận alias và test tương ứng. Khi giải quyết conflict, bỏ ngữ cảnh `lastCallMetrics` chưa có ở base; test bỏ hai assertion metrics, giữ kiểm tên request/response và guard alias khác. Diff với base chỉ có hai file provider/test, 26 insertions, 1 deletion. Provider test 19/19, exit 0. Không push nhánh này.
- GET models trước đo: HTTP 200, có `ag/gemini-3.8-flash`. Request qua localhost:20128, llm, concurrency 2; `.env` gốc nạp bằng `--env-file`.
- Bắt đầu `2026-10-08T04:32:33.902Z`, kết thúc `2026-10-08T04:33:35.920Z` (11:32–11:33 Việt Nam).
- Runner exit 2; chỉ 2/50 lượt được thử: ss01 timeout, 60143 ms; ss02 bị hủy theo sibling, 60071 ms; mỗi câu 1 lời gọi model. Không có phản hồi model hợp lệ/served model. Mã đối chứng không có kênh đo attempt nên không gán số attempt từ latency.
- Đã dừng toàn bộ hàng đợi đối chứng/đo sau sửa và báo người dùng kiểm cổng. Không tự khởi động hoặc đổi cấu hình 9router.
- Không dùng sample này cho parity/p95 hoặc bảng đối chứng hoàn chỉnh. Raw output của runner cũ giữ riêng ngoài repo; bản public lọc prompt/bí mật sau scoring, chỉ giữ phân loại lỗi. Scan public 3 file tại thời điểm dừng: 0 vi phạm.
