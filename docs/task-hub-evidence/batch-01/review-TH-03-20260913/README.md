# Nghiệm thu độc lập TH-03

**ACCEPTED — 2026-09-13.** Đủ điều kiện chuyển sang TH-04 khi được giao. Phạm vi nghiệm thu: ba tool đọc card/member, metadata múi giờ, discovery/catalog sáu tool và hồi quy engine B/local. Antigravity triển khai bằng Gemini 3.8 Flash High; Codex review, yêu cầu sửa và kiểm chứng độc lập.

- `npm run check:engine`: **exit 0; 96 passed, 0 failed, 0 skipped** — 39 DSL, 32 DB/MCP, 25 engine. Lượt Codex chạy từ 09:31:05 đến 09:32:50 UTC; xem [command-result.json](command-result.json) và [check.log](check.log).
- Probe độc lập qua MCP thật: sáu tên/schema khớp cả built contracts và catalog; ba schema cũ giữ nguyên; bốn calls tới `create_card`/`move_card` với auth thiếu hoặc không tồn tại đều bị chặn; ba metadata runtime sai bị từ chối; toàn bộ rows cards/receipts/messages/sheets không đổi. DB UUID của probe đã được dọn. Xem [review-probe.mjs](review-probe.mjs) và [probe-results.json](probe-results.json).
- **29 checksum bảo vệ khớp**: 26 evidence lịch sử và ba migration 0001–0003. **12 file source/test/script/catalog/lock/migration không đổi trong lượt kiểm chứng**; xem [source-hashes-before.json](source-hashes-before.json) và [source-verification.json](source-verification.json).
- R01–R11 có kết quả thực: owner/board isolation, empty/missing resources, strict input, hai bộ biên ngày HCM/New York DST, active workload, giới hạn 1001 và thứ tự khi trùng timestamp. Test engine lưu `America/New_York` trong run, đi qua MCP thật, kiểm exact IDs trong trace và giữ authorization cho writes cũ.

Các điểm review đã xử lý: bổ sung owner-only board/list/member fixtures, schema equality cho sáu tool, khôi phục evidence bị ghi nhầm vào thư mục lịch sử và ghi lại deviation sync sớm. Test output corruption được tách riêng, chỉ thay constraint trong DB suite tạm và phục hồi bằng `finally`; production contract giữ nguyên. Giả định emoji của Codex không đúng với Zod đang cài và đã được loại bỏ. Tên test, số test và số checkbox trong báo cáo đã được đối chiếu lại.

Không có lỗi chức năng còn chặn checkpoint trong phạm vi trên. `create_card` và `move_card` vẫn disabled/SPEC_ONLY; HTTP/UI/LLM, migrate demo DB và các task TH-04 trở đi không thuộc kết quả nghiệm thu này. Evidence observations là bản của lượt kiểm thử cuối, không phải archive riêng cho mọi lượt thử trung gian.

HEAD khi nghiệm thu: `3f68eafcaf9799cb4bf0923df0d3a398fc4ab380`. Các thay đổi TH-03 chưa stage/commit/push. [Báo cáo triển khai](../TH-03.md) ghi chi tiết kết quả và các sự cố đã xử lý.
