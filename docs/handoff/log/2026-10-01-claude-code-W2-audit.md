# 2026-10-01 · Claude Code · Audit tuần 2 và task W2-05

- **Đã làm:** audit W2-01, W2-02, W2-04 trên `main` `e6ea708` trong worktree riêng; viết task card W2-05; sửa mô tả PR #15 (PR này đã mang theo code W2-01 qua #16).
- **Kiểm tra đã chạy:** `npm run check` exit 0 (v3 479/479, eval 66/66, typecheck/build, launcher, local-env); `npm run test:browser:v3` 7/7. Khớp với số liệu agent thi công ghi.
- **Probe trên PostgreSQL thật** (file tạm, đã xóa): (A) step 1 `succeeded`, step 2–3 `pending`, plan `approved` → sau đối soát chỉ Stop, Skip trả 409; (B) mọi step `succeeded`, plan `approved` → `reconciliation_required`, Stop xong thành `stopped`; (C) skip step `unknown` → step 3 resolve đúng output đã lưu của step 1, step 1 không bị gọi lại.
- **Vấn đề phát hiện:** A và B (đúng với đặc tả 5.8 hiện tại, nhưng đặc tả nên đổi) → W2-05. Agent thi công tự sửa đặc tả v3 mục 5.8 trong PR thi công; về sau thay đổi đặc tả nên được ghi rõ trong mô tả PR để người dùng duyệt. PR #16 merge vào nhánh tài liệu thay vì `main`. Review "độc lập" của W2 do cùng loại agent thực hiện. Phần hiển thị tham số trong `ReconciliationNotice` dùng quy ước riêng để resolve `$ref` (sai nếu output thật có trường tên `output`; chỉ ảnh hưởng hiển thị). Hai ảnh bằng chứng được commit vào repo công khai (dữ liệu sandbox).
- **Việc tiếp theo đề xuất:** giao W2-05; W2-03 khi người dùng sẵn sàng duyệt lệnh ghi thật.
