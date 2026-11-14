# Checklist review (chỉ cho PR rủi ro cao)

Chỉ cần review khi PR đụng vào: migration DB, OAuth/token, luồng gửi hoặc ghi ra dịch vụ thật, xoá dữ liệu, hoặc CI. Đọc diff, không cần chạy lại toàn bộ suite vì CI đã chạy.

- [ ] Làm đúng việc PR nói, không lẫn thay đổi khác.
- [ ] Không phá bất biến an toàn ở `AGENTS.md` mục 3: duyệt trước khi ghi, không tự chạy lại khi `unknown`, đúng phạm vi tài nguyên, không lộ secret, migration chỉ thêm.
- [ ] Có test cho hành vi mới hoặc bug đã sửa; test DB chạy trên PostgreSQL thật.
- [ ] CI xanh.

Kết luận ghi trong PR: **OK** hoặc **Cần sửa** (liệt kê file:dòng và lý do).
