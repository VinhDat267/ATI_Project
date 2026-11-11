# NOTION-N2B · Tích hợp OAuth durability lên main

- Base tích hợp: `e12c94d3` (sau PR #316).
- Nguồn: `6588b5c3e001aaa24b41a71ce169fe06c2fb84df`.
- Phạm vi: khôi phục OAuth, bảo toàn credential trước lỗi tài nguyên/refresh, ngắt kết nối, migration `0036` và UI kết nối.

## Tiêu chí nghiệm thu

- [x] Đối chiếu 16 file của commit nguồn trước khi chỉnh test harness.
- [x] Áp dụng migration trên PostgreSQL 16 dùng riêng và kiểm thử lại migration, đồng thời, mất phản hồi và restart.
- [x] Kiểm thử giao diện kết nối và typecheck.
- [ ] CI của PR hoàn tất, reviewer độc lập xác nhận theo checklist.

## Kết quả

- Commit tích hợp `b0ffd160` giữ nguyên blob của 16 file nguồn.
- Commit tiếp theo cho phép hai test replay chuỗi migration chạy tối đa 30 giây mỗi test. Cả hai vượt mốc 5 giây khi chạy cùng các suite khác trên Windows. Các kiểm tra dữ liệu, lock timeout và statement timeout của PostgreSQL giữ nguyên.
- PostgreSQL 16 dùng riêng: `npm run db:migrate:v3` exit 0, gồm cả `0035` và `0036`. Sáu suite API OAuth/migration: 35/35 PASS, exit 0. Suite Web: 15/15 PASS, exit 0. `npm run typecheck:v3` exit 0.
- Nghiệm thu này giới hạn ở OAuth N2B. Ràng buộc nguồn lịch, độ đầy đủ báo cáo và nghiệm thu provider thật vẫn mở.
