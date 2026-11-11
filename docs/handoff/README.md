# Bàn giao giữa các agent

Không agent nào nhớ phiên của agent khác. Trí nhớ chung của dự án gồm:

| Nguồn | Dùng để |
|---|---|
| [CURRENT-STATE.md](CURRENT-STATE.md) | Một trang: trạng thái từng dịch vụ, việc đang làm, lỗi đã biết. PR nào làm đổi trạng thái thì sửa dòng tương ứng |
| [ROADMAP.md](ROADMAP.md) | Danh sách việc ưu tiên ngắn |
| Mô tả PR + `git log` | Nhật ký chi tiết của từng thay đổi |
| [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) | Checklist ngắn cho PR rủi ro cao |
| [PROMPTS.md](PROMPTS.md) | Câu lệnh mẫu giao việc |

Quy tắc làm việc: [`AGENTS.md`](../../AGENTS.md).

- `tasks/` và `log/` là tài liệu cũ, giữ để tra cứu. Không bắt buộc tạo task card hay file log mới; chỉ viết task card khi giao một việc lớn cần mô tả kỹ.
- Quy trình cũ (CURRENT-STATE chi tiết, ROADMAP theo tuần, FINISH-PLAN, prompt P-*) nằm ở [`docs/archive/handoff-2026-11-12/`](../archive/handoff-2026-11-12/README.md).
- Riêng Slack cá nhân: xem [SLACK-DELIVERY.md](SLACK-DELIVERY.md).
