# Đối chứng core gián đoạn lần hai — 08/10/2026

- Cùng source đối chứng `7898aa7`, base `8155c03` + riêng alias `845701c` đã giải quyết conflict; nhánh tạm local, không push.
- Sau khi người dùng xác nhận 9router vẫn hoạt động, GET models mới trả 200, có model yêu cầu. Không khởi động hoặc sửa cấu hình cổng.
- Bắt đầu `2026-10-08T04:35:46.975Z`, kết thúc `2026-10-08T04:36:47.927Z` (11:35–11:36 Việt Nam). Request `ag/gemini-3.8-flash`, llm/concurrency 2, core 50×1; `.env` gốc nạp qua `--env-file`.
- Runner exit 2, 2/50 lượt được thử, không có phản hồi model hợp lệ hoặc served model. ss01 timeout, 60100 ms; ss02 bị hủy theo sibling, 60060 ms; mỗi câu 1 lời gọi model. Không có kênh đo attempt ở mã cũ nên không suy số attempt từ latency.
- Đã dừng hàng đợi và báo người dùng kiểm completion/upstream. GET models hoạt động không chứng minh completion hoạt động. Giữ nguyên timeout/retry, model/alias và cấu hình 9router.
- Bản public đã lọc chuỗi prompt/bí mật sau scoring, chỉ giữ phân loại lỗi; raw report ở ngoài repo. Không dùng sample dở dang này cho strict parity, p95 hoặc đối chứng hoàn chỉnh.
