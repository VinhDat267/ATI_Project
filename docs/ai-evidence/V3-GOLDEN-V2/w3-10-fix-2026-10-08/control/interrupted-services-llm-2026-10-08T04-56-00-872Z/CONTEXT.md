# Đối chứng services gián đoạn — 08/10/2026

- Source `7898aa7`: base8155c03 + riêng alias845701c. Nhánh tạm local, không push; llm/concurrency2, services44×1, requestag/gemini-3.8-flash. Env gốc nạp bằng--env-file; không in/copy/commit.
- Sau probe tối giản xác minh completion hoạt động, freshGETmodels200 trước campaign.
- Bắt đầu `2026-10-08T04:55:59.107Z`, kết thúc `2026-10-08T05:00:09.534Z` (11:55–12:00 Việt Nam); runnerexit2,12/44đãthử,8strictpass.
- `ca01` provider timeout,103323ms trong3modelcalls; `ca04` bị hủy theo sibling,49620ms trong1modelcall. Không suy số attempt từ latency do mã cũ không có instrumentation.
- Hai câu chỉ đọc sh01/sh07 đã hoàn tất nhưng không đạt nhãn cũ:3modelcalls,73527/86545ms. Đây là đối chứng policy cũ, không áp rubric read_only mới hoặc coi là hồi quy của bản sửa.
- Không có run services đầy đủ; đã dừng hàng đợi trước corrected services/core/freeform. Không ghép sample với các phần core hoặc dùng làm p95/parity. Giữ fault và sibling cancellation riêng, publiccopy chỉ lọc prompt/bí mật/lỗi nhạy cảm sau scoring, rawreport ngoàirepo.
- Cổng có hoạt động nhưng completion chưa đủ ổn định với deadline/retry hiện hữu để hoàn tất đối chứng. Không tự tăng deadline, đổi9router/model/cx hoặc retry liên tục để lấy campaign xanh. Cần trạng thái upstream thay đổi trước khi đo lại cùng cấu hình.
