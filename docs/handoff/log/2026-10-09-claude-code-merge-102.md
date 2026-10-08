# 2026-10-09 · Claude Code · Review và merge #102 (W3-10)

- **Đã làm:**
  - **Review độc lập #102: Đạt**, không có P1/P2. Mục tiêu p95 services dưới 15 s chưa đạt (20,1 s); task card cho phép khi có báo cáo nguyên nhân bằng số liệu. Xem [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/102#issuecomment-6070117788).
  - **Merge:** người dùng cho phép. Merge lúc 05:33:01 Việt Nam ngày 09/10 tại `d40d735`, khoá theo head `7301d66`, CI PR xanh.
    - PR chậm hơn `main` hai PR (#116, #117) nhưng không chung file; `git merge-tree` không xung đột.
    - Tổ hợp được kiểm sau merge trên `main` (xem dưới).
  - Đã xoá nhánh trên GitHub; worktree của Codex để Codex dọn.
  - Cập nhật CURRENT-STATE (đầu trang, trạng thái service mới, mục 3, 4, 5, 6) và ROADMAP (dòng W3-10).
- **PR / commit:** nhánh `docs/state-after-102`.
- **Kiểm tra đã chạy (lệnh và kết quả):** PostgreSQL 16 tmpfs riêng ở cổng 56533, sandbox. Windows đang giữ dải 55448–56047, gồm cổng 55533 mặc định.

  | Bản | `npm run check` | `npm run test:browser:v3` | Khác |
  |---|---|---|---|
  | head #102 `7301d66` | exit 0, 1.544 v3 + 173 eval | exit 0, 73/73 | đột biến 8/9 bị bắt; label `795229e` đứng trước báo cáo `66896ca`, không đổi sau đó; số liệu khớp `report.json` gốc |
  | `main` `d40d735` sau merge | exit 0: 47 + 340 + 212 + 25 + 353 + 593 = **1.570 v3**, cộng **173 eval** | lần 1 exit 1, 77/78 (ca `AUTH-04: Google signup…` không thấy thông báo chờ duyệt, không có ảnh lúc lỗi); chạy lại exit 0, **78/78** | – |

  [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37854177550) SUCCESS đúng `d40d735`.
- **Chưa làm / vấn đề phát hiện:**
  - **Latency:** services p95 20,1 s; freeform chậm hơn mốc W3-06 và không có đối chứng cùng ngày.
  - **Câu hỏi lại cho yêu cầu chỉ đọc:** chưa có trường loại có cấu trúc, nên không khớp regex của FE-06b.
  - **Test:** 6 test integration của `chat-api` lỏng hơn.
  - **Test chập chờn:** thêm ca AUTH-04.
  - **Máy nhóm trưởng:** cổng 55533 đang bị Windows giữ.
  - Chi tiết ở CURRENT-STATE mục 5 và 6.
- **Việc tiếp theo đề xuất:**
  - task latency riêng, có đối chứng freeform, kèm trường loại câu hỏi lại;
  - W3-11;
  - FE-08, FE-09.
