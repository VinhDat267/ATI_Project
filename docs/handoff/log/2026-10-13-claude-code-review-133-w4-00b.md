# 13/10/2026 · Claude Code · Review độc lập #133 (W4-00) và task card W4-00b

- #133 đã được người dùng merge (`6ee4109`) và Codex ghi vào handoff qua #134 trước khi review này xong. Review của Claude Code trên head `2d80355`: **Đạt**, không có P1/P2; cây merge bằng head. [Bình luận review](https://github.com/VinhDat267/ATI_Project/pull/133#issuecomment-6129690726).
- Đã kiểm ở máy:
  - 70/70 file bằng chứng khớp manifest SHA-256;
  - tính lại 18 `report.json`, mọi số trong báo cáo và task card khớp;
  - log khởi động `cx/gpt-6.1-sol`, preview rồi Hủy (`rejected`, 0 `execution_steps`, 0 lượt duyệt), hai ảnh;
  - test provider 19/19 và fault probe HTTP localhost 5/5, exit 0;
  - không có giá trị `.env` hay mẫu token nào trong diff.
- Không chạy lại `npm run check`/browser: PR chỉ sửa tài liệu, CI đúng head đã chạy đủ.
- Phát hiện ngoài phạm vi W4-00:
  - validator chấp nhận `${<bước>.output…}` trong chuỗi thường, không bọc `$template`;
  - executor để nguyên chuỗi đó (`resolver.ts:58–60`), nên nếu người dùng duyệt thì chuỗi được ghi thẳng lên dịch vụ;
  - quét report: Luna 23 ca; Gemini (khoảng 1.850 kế hoạch) và `cx/gpt-6.1-sol` (62 kế hoạch) không có ca nào;
  - đã ghi vào CURRENT-STATE mục 5, task card [W4-00b](../tasks/W4-00b-raw-step-placeholders.md) và một dòng ROADMAP.
- Runbook W4-00 (`evaluations/README.md`): đoạn PowerShell đo chất lượng thêm dòng gỡ biến môi trường. Trước đó `LLM_MODEL=cx/…` còn lại trong cửa sổ, nên chạy `npm run up` ngay sau sẽ dùng model dự phòng.
- Chưa làm: core của `cx/gpt-6.1-sol` vẫn thiếu `cl04`, `rf07`. Đóng được bằng `EVAL_ONLY=cl04,rf07`, khoảng 3–4 lời gọi.
