# PLANORA-00 · Lập kế hoạch chuyển toàn bộ giao diện sang Planora

## Yêu cầu

Ngày 02/11/2026, chủ dự án yêu cầu kế hoạch chi tiết thay đổi giao diện hiện tại sang Planora cũ và chỉ ra giao diện còn thiếu. Chủ dự án đã chọn **khôi phục cả bố cục Planora cũ**.

## Phạm vi

Chỉ khảo sát và tài liệu: spec/bảng đối chiếu, kế hoạch triển khai, card này và log bàn giao. Không thi công frontend, đổi backend, chạy migration, bật feature flag, merge/deploy hay sửa CURRENT-STATE/ROADMAP.

## Tài liệu

- [Thiết kế và inventory](../../superpowers/specs/2026-11-02-planora-migration-design.md).
- [Kế hoạch 15 task](../../superpowers/plans/2026-11-02-planora-migration.md).

## Tiêu chí nghiệm thu

- [x] Đối chiếu main mới nhất đã khảo sát và Planora cũ theo commit rõ ràng.
- [x] Phân biệt phần có mẫu, phần phải mở rộng và phần chưa có Planora.
- [x] Đủ route, callback, chat state, workspace/permission, provider scope, schedule/digest, account/admin, trang công khai và dark theme.
- [x] Có ranh giới giữ logic/API main, thay lớp trình bày, file/task/test phù hợp.
- [x] Có builder check độc lập, kiểm tính đầy đủ tài liệu thực tế và một log mới.
- [x] Không sửa product code hoặc trạng thái roadmap.
- [ ] Chủ dự án duyệt thiết kế/kế hoạch trước khi thi công.

## Kết quả

Đã lập **bản dự thảo**, không phải nghiệm thu chuyển giao diện.

Nền: main `1977ec7`. Mẫu: `Frontend_UXUI@ef13c56`; tài liệu chuẩn hóa Planora `6b324aa` chỉ tham khảo. Đề xuất bắt đầu từ main, phục hồi sidebar/chat và skin Planora rồi bổ sung UI mới; PR #262 giữ làm reference, không merge nguyên nhánh.

Kiểm kê trực tiếp: 22 route entries, 13 Cockpit states, 8 callback view (Google login + 7 connection), 15 task có dependency/files/interfaces/verification. Builder check độc lập: “nothing important left”.

Validation Python: **exit 0**, kiểm số route/state/task, callback/file tồn tại, link spec và whitespace. Chưa chạy runtime/unit/browser; không dùng kết quả lịch sử để khẳng định tương thích.

Nhánh tài liệu: `codex/planora-migration-plan`, worktree riêng. Xem log cùng ngày cho bằng chứng và giới hạn.
