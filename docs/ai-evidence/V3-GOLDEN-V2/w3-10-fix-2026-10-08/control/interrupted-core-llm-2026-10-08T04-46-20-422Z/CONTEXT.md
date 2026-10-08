# Đối chứng core gián đoạn lần ba — 08/10/2026

- Source đối chứng `7898aa7`: `8155c03` + chỉ patch alias `845701c`, llm/concurrency2, core50×1. Nhánh tạm không push.
- Sau chẩn đoán chỉ đọc theo yêu cầu người dùng, probe nhận completion đúng alias -n qua retry. Fresh GET models trả200 trước khi tiếp tục.
- Bắt đầu `2026-10-08T04:46:19.809Z`, kết thúc `2026-10-08T04:51:34.563Z` (11:46–11:51 Việt Nam), runner exit2.
- 25/50 lượt đã thử,23strict pass. `cs02` timeout60036ms; `cs05` bị hủy theo sibling sau4538ms. Không ghép sample này với hai sample trước hoặc campaign đầy đủ.
- 23 câu hoàn tất đều chỉ cần một model call; latency thường khoảng15–26s,ss07 52099ms,ss10 44576ms,ms04 47859ms. Mã cũ không có diagnostics attempt, không suy số attempt/timeout từ duration của các lượt thành công.
- Dừng hàng đợi. Không bắt đầu corrected core/freeform/services hoặc đối chứng services sau fault. Sample này chứng minh completion có hoạt động nhưng không đủ ổn định với deadline/retry hiện hữu để hoàn tất core50; không chứng minh parity hoặc p95 cả bộ.
- Bản public lọc chuỗi prompt/bí mật/lỗi nhạy cảm sau scoring, raw report giữ riêng ngoài repo; lỗi public phân biệt timeout và sibling cancellation. Không đổi cấu hình/model/deadline của9router hoặc planner để vượt gate.
