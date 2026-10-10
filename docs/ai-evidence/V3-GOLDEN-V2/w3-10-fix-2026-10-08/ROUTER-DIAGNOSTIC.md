# Chẩn đoán chỉ đọc 9router — 08/10/2026

Người dùng yêu cầu tự kiểm tra sau hai campaign core đối chứng gián đoạn.
Không khởi động/sửa cấu hình cổng, không đổi request model hoặc alias.

- Tiến trình Node phục vụ cổng 20128 đang chạy; GET `/v1/models` trả 200.
- Đọc SQLite của 9router bằng kết nối `mode=ro&immutable=1`, chỉ xuất metadata, không xuất prompt/header/token/tên tài khoản. Log usage có các phản hồi `ok` của provider antigravity/model gemini-3.8-flash trong khung giờ campaign và sau khi client đã hủy. Không có requestDetails/timing tương ứng để gắn chính xác từng record cho request của task; không coi usage `ok` là bằng chứng client nhận được câu trả lời. Ba connection antigravity active, không thấy cooldown; không có bằng chứng HTTP429 hay chuyển tài khoản cho request bị timeout.
- Probe một câu core tại source đối chứng `7898aa7`, provider thật cùng model, timeout/retry nguyên trạng. Wrapper fetch bên ngoài nhánh chỉ ghi timestamp/status/thời gian nhận headers và đọc body; không lưu request/response body. Nạp `.env` gốc qua `--env-file`.
- [Số liệu probe](ROUTER-DIAGNOSTIC.json): bắt đầu `2026-10-08T04:44:45.278Z`, kết thúc `2026-10-08T04:45:39.232Z`, tổng 53952 ms, một lời gọi model, hai lần fetch thực tế. Lần đầu bị deadline hủy sau 30005.762 ms trước khi nhận headers. Lần sau headers HTTP200 sau 23885.483 ms, body xong sau 23887.632 ms, served `gemini-3.8-flash-n`.
- Điểm chậm nằm trước khi nhận response headers; probe không chỉ ra được phần nào là queue/mạng/suy luận upstream. Không có bằng chứng lỗi đọc JSON. Không tăng deadline để làm đẹp kết quả.
- Probe dùng riêng cho chẩn đoán, không gộp vào đối chứng hoặc campaign nghiệm thu. Completion đã được xác minh hoạt động; sau fresh GET200 tiếp tục hàng đợi đo đầy đủ với cấu hình cũ.
- Sau khi core đối chứng lần ba lại dừng ở cs02, probe đầu vào tối giản tại `04:54:25.914Z–04:54:36.665Z` thành công trong 10.750s, một attempt, served -n. Headers10.747s, body thêm2.423ms; completion5tokens/reasoning111tokens. [Metadata](ROUTER-MINIMAL-DIAGNOSTIC.json) không ghi nội dung prompt. Ngay cả đầu vào nhỏ cũng có thời gian chờ trước headers đáng kể; chưa tách được mạng/queue/suy luận. Đây là probe riêng, không tính vào benchmark. Sau freshGET200 chuyển sang cặp services, giữ core gián đoạn riêng.
