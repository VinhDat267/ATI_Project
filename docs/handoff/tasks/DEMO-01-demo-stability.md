# DEMO-01 · Ổn định demo cho buổi bảo vệ

**Trạng thái:** chờ · **Người làm:** nhóm trưởng (`VinhDat267`) thao tác, agent thi công viết runbook và ghi bằng chứng · **Nhánh gợi ý:** `docs/demo-01-runbook` · **Phụ thuộc:** mốc ngừng thêm tính năng 04/11 và tag `demo-2026-11-04`; các quyết định bật cờ (FINISH-PLAN mục 4) · **Mốc:** 05–06/11/2026
**Kế hoạch tổng:** [FINISH-PLAN](../FINISH-PLAN.md).

## Mục tiêu

Ngày bảo vệ, demo chạy được trên máy của nhóm trưởng:
- dựng lại từ đầu theo một runbook;
- ba kịch bản, mỗi kịch bản chạy **3 lần liên tiếp không lỗi** ở chế độ live;
- chuyển sang LLM dự phòng được trong vài phút;
- có đường lui khi mạng, gateway hoặc dịch vụ hỏng.

## Kịch bản

Chọn theo các cờ đã bật lúc 04/11. Mỗi kịch bản phải chỉ ra được: AI chọn tool, kế hoạch nhiều bước, **người dùng duyệt đúng kế hoạch**, kết quả có link thật.

| # | Khi cờ bật | Khi cờ tắt (thay thế) | Điều cần chỉ cho hội đồng |
|---|---|---|---|
| 1 | Workflow 4 dịch vụ: Jira → Notion → Telegram → Slack (đã chạy thật ở W3-11 ngày 16/10) | như cột trái | Một câu chat thay 4 thao tác; bước sau dùng kết quả bước trước (`$ref`); biên nhận có link |
| 2 | Gmail riêng (`GMAIL_ENABLED`): trả lời một luồng thư, màn duyệt hiện "Gửi từ" và nguồn người nhận; nếu có OAUTH-01 thì bắt đầu từ màn từ chối "Kết nối Gmail" | Sheets → Slack, kèm **Hủy** một kế hoạch, và "Sửa qua Chat" rồi duyệt bản mới | Dữ liệu riêng của từng người; không ghi gì khi chưa duyệt; sửa kế hoạch bằng chat |
| 3 | Lịch chạy (`SCHEDULES_ENABLED`): "Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test" → Xác nhận → "Chạy lượt này ngay" → duyệt → biên nhận; tab Nhật ký có số lượt chờ duyệt | Câu chỉ đọc: hỏi lại, hoặc trả lời nếu `PLANNER_READ_ANSWERS` bật | Mỗi lượt lập kế hoạch mới và vẫn chờ duyệt; không có chế độ tự chạy |

Câu chat chính xác của từng kịch bản viết vào runbook và **không đổi** sau khi chạy đạt 3 lần. Model là máy học: câu khác có thể ra kế hoạch khác.

## Việc cần làm

1. **Runbook** `docs/demo/DEMO-RUNBOOK.md` (commit, không có bí mật):
   - **Máy và phần mềm:** Node, Docker, 9router; cổng 3000/5174; trình duyệt.
   - **Dựng từ đầu:**
     - `git checkout demo-2026-11-04`, `npm ci`;
     - DB demo riêng: không phải DB dev, không phải DB test; dùng volume riêng để giữ được giữa các lần chạy;
     - `npm run db:migrate:v3`, tạo tài khoản demo;
     - nhập khoá dịch vụ ở `/settings`, rồi "Kiểm tra kết nối" thấy 8 dịch vụ `healthy`;
     - kết nối Gmail nếu bật;
     - `RUNTIME_MODE=live npm run up`.
   - **Tài nguyên thử và cách dọn sau mỗi lần chạy:** card Trello, tin Slack, page Notion, issue Jira, sự kiện Calendar, dòng Sheets, thư Gmail. Ghi rõ cái nào xoá tay, cái nào để lại.
   - **Từng kịch bản:** câu chat; màn hình nào chỉ vào đâu; kết quả mong đợi; cách kiểm (link mở được, đọc lại bằng tool đọc hoặc mở dịch vụ).
   - **Chuyển LLM dự phòng** (runbook W4-00): lệnh đổi `LLM_MODEL`, khởi động lại, kiểm một kịch bản.
   - **Xử lý sự cố:**
     - 9router chết;
     - một dịch vụ trả 401;
     - lập kế hoạch quá 60 s (màn "lập kế hoạch lâu", bấm "Thôi chờ", gửi lại);
     - mất mạng (chiếu video VIDEO-01).
   - **Kiểm tra trước giờ bảo vệ:** checklist 15 phút. Xem REHEARSAL-01.
2. **Chạy thử:**
   - mỗi kịch bản 3 lần liên tiếp. Lần nào lỗi thì đếm lại từ đầu sau khi sửa;
   - mỗi lần ghi giờ, câu chat, kết quả, thời gian tới màn duyệt, và link biên nhận.
3. **Diễn tập LLM dự phòng:** chuyển sang `cx/gpt-6.1-sol`, chạy kịch bản 1 một lần tới màn duyệt rồi **Hủy**, chuyển về lại.
4. **Lỗi phát hiện khi chạy thử:**
   - lỗi chặn demo: mỗi lỗi một PR sửa, có review độc lập, merge, rồi tag lại (`demo-2026-11-04b`…);
   - lỗi không chặn demo: ghi vào báo cáo, mục giới hạn.

## Bằng chứng

- `docs/ai-evidence/DEMO-LIVE/<ngày>/`, không commit, đã có trong `.gitignore`: log từng lần chạy, ảnh biên nhận, SHA-256 từng file.
- Log `docs/handoff/log/<ngày>-<người>-DEMO-01.md` (commit): bảng 3 kịch bản × 3 lần (giờ, đạt/không, thời gian tới màn duyệt), tag dùng, model dùng, sự cố và cách xử lý.

## Tiêu chí nghiệm thu

- [ ] Runbook đủ các mục trên; một người khác trong nhóm dựng lại được theo runbook mà không hỏi thêm.
- [ ] Ba kịch bản × 3 lần liên tiếp đạt ở chế độ live, đúng tag demo.
- [ ] Chuyển LLM dự phòng và chuyển về đã chạy thử, có thời gian thực hiện.
- [ ] Mọi lệnh ghi đều theo kế hoạch nhóm trưởng duyệt; tài nguyên thử được dọn theo runbook.

## Ngoài phạm vi

- Tính năng mới (đã ngừng từ 04/11).
- Đo lại golden.

## Kết quả (người làm điền)

- PR:
- Bảng chạy thử:
- Sự cố và cách xử lý:
