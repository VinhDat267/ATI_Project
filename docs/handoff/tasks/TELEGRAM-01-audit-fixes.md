# TELEGRAM-01 · Sửa ba lỗi audit PR #242

**Trạng thái:** đã merge phần mã qua [#247](https://github.com/VinhDat267/ATI_Project/pull/247) tại `43b038ba`, 02/11/2026 · **Nhánh:** `fix/telegram-audit` · **Base:** `469825d1`

Theo yêu cầu chủ dự án ngày 02/11/2026: sửa Telegram trước, gồm F1/F7/F8 của audit sáu PR.

## Phạm vi

- Chặn gửi khi lịch bị hủy/tạm dừng/đổi version trong lúc đọc; giữ delivery nếu gửi đã hoàn tất.
- GitHub source dùng tool thật, có repo thuộc scope được xác nhận.
- Pairing vượt backlog 100 update mà không mất pairing của người khác, có cursor/inbox bền vững.
- Không thay đổi các dịch vụ khác, 33 tools, prompt, flag mặc định, CURRENT-STATE hoặc ROADMAP.

## Nghiệm thu

- [x] PostgreSQL thật: cancel/pause/version change trước dispatch → zero Telegram writes.
- [x] Cancel sau dispatch → delivery vẫn được lưu; send và cancel serialize bằng row lock.
- [x] Candidate GitHub đi qua GitHubAdapter thật, query đúng repo; không quảng bá auto khi thiếu scope GitHub.
- [x] Backlog >100, hai pairing đồng thời, client restart, lỗi persistence/abort không làm mất update.
- [x] Full check và review độc lập; native provider/model ghi rõ nếu NOT_RUN.

## Kết quả

Đã sửa F1/F7/F8 cùng các boundary long-message/idle cursor phát hiện trong review. Full check3160 v3 +406 eval +99 Node/launcher PASS, exit0. Review độc lập không còn finding cần sửa sau re-review. Native provider/model và local full browser NOT_RUN. Xem [nhật ký](../log/2026-11-02-fix-telegram-audit.md). Cần [#246](https://github.com/VinhDat267/ATI_Project/pull/246) trước triển khai trên DB đã có digest/OAuth state.

Commit implementation: `087ddd0f95f62337e9d49deceae9edcc2c6f2c19`.

Reviewer merge theo yêu cầu chủ dự án: [#246](https://github.com/VinhDat267/ATI_Project/pull/246) tại `b92cc4fc` trước, [#247](https://github.com/VinhDat267/ATI_Project/pull/247) tại `43b038ba` sau; phụ thuộc migration đã được tích hợp. CI SUCCESS đúng head `34135e21`, gồm check/browser. Reviewer chạy full check cây kết hợp **3.163 v3 +406 eval fixture +99 Node/launcher PASS**, exit0; merge tree trùng cây kiểm thử. Bot/provider/model thật vẫn NOT_RUN. [Bằng chứng merge](../log/2026-11-02-reviewer-merge-246-247.md).
