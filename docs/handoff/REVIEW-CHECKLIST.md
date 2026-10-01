# Checklist review PR

Dùng khi review PR của bất kỳ agent nào. Kết luận mặc định là "chưa đạt" cho đến khi có bằng chứng.

## 1. Đúng việc
- [ ] PR làm đúng task card được giao; mọi tiêu chí nghiệm thu đều có bằng chứng, hoặc được ghi rõ là chưa làm và vì sao.
- [ ] Không có thay đổi ngoài phạm vi (sửa thư mục v2, đổi file của task khác, đổi `ROADMAP.md` khi không được giao).

## 2. Đúng về kỹ thuật
- [ ] Đọc diff thật, không chỉ đọc mô tả PR. Chạy lại các test mới và cả bộ test ở máy.
- [ ] Test mới thực sự kiểm tra hành vi: thử bỏ phần sửa đi thì test phải fail. Không có mock hình thức; logic database test trên PostgreSQL thật; timeout test bằng `AbortSignal` thật.
- [ ] Không có lệnh ghi nào có thể chạy lại khi chưa rõ kết quả (`unknown` chỉ được skip).
- [ ] Không có secret trong code, log, mô tả PR hay bằng chứng commit lên repo công khai.
- [ ] Nếu đổi prompt hoặc planner: có chạy lại golden set với model thật, hoặc ghi rõ là chưa chạy.

## 3. Đúng quy trình
- [ ] CI xanh trên PR. Không merge khi CI đang chạy hoặc đỏ.
- [ ] `CURRENT-STATE.md`, phần "Kết quả" của task card và `HANDOFF-LOG.md` được cập nhật trong cùng PR.
- [ ] Commit theo Conventional Commits; mô tả PR không có dòng "Generated with …".

## 4. Kết luận
Ghi vào PR một trong ba: **Đạt**, **Đạt sau khi sửa nhỏ** (liệt kê), **Chưa đạt** (liệt kê lỗi, mỗi lỗi có file:dòng và cách tái hiện).
