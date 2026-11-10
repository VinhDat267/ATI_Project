# 2026-11-10 · TRELLO-V3-B — Khắc phục Backend cho Trello & Telegram Digest (Owner B)

- **Nhánh:** `VinhDat267/fix-trello-digest-v3`
- **Baseline SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`
- **Task card:** [`docs/handoff/tasks/TRELLO-V3-B-backend-digest-remediation.md`](../tasks/TRELLO-V3-B-backend-digest-remediation.md)
- **Database kiểm thử cô lập:** container Docker PostgreSQL 16 riêng `ati-trello-remed-b-20261110` tại `127.0.0.1:61165` (`postgresql://audit_b:audit_b_fake_only@127.0.0.1:61165/audit_b`), đã gỡ bỏ sau khi hoàn tất kiểm thử. Không chạm cổng `55533` hay `56534`.
- **Thư mục bằng chứng ngoài git:** `D:/ATI-Audits/trello-remediation-20261110/owner-b/`

## Tóm tắt các phát hiện đã xử lý (13 phát hiện chuẩn tắc + R1)

1. **`TRELLO-AUDIT-03` (`F3`, P2 — phía API):** `ExecutionService.getExecutionStatus` giữ nguyên trạng thái `reconciliation_required` khi step ở trạng thái `unknown`.
2. **`TRELLO-AUDIT-05` (`AUTO-01` / `PROD-03`, P2 — phía API/renderer & `types.ts`):** Loại trùng `card.id` khi tổng hợp thẻ; tách biệt `scannedCount` (tối đa 50 thẻ/bảng), `uniqueScannedCount`, `duplicateCountDropped`, `matchedCounts` thực tế trên tập đã quét và `displayedCounts` (tối đa 15 thẻ/nhóm); bổ sung `TrelloDigestCoverageSummary` (`totalAvailable: 'UNKNOWN'`, `isComplete: false`) vào `TrelloDigestDelivery.coverage`; luôn hiển thị dòng cảnh báo độ phủ một phần ngay cả khi có 0 thẻ khớp; cắt văn bản theo dòng ở mốc 3.500 ký tự mà không cắt ngang URL/dòng và không làm mất cảnh báo độ phủ; đọc `(cards as any)?.scanMetadata` khi Worker A cung cấp.
3. **`TRELLO-AUDIT-06` (`AUTO-02`, P1):** Truyền ngữ cảnh workspace tin cậy (`workspaceMode`, `workspaceId`) từ `RunToPlan` / `ChatService` qua `evaluateTrelloDigestCandidate`, `trelloConnection`, `AdapterFactory` và runner; chặn việc rơi về `'default'` hoặc credential không gắn phạm vi khi chạy ở chế độ `organization`.
4. **`TRELLO-AUDIT-07` (`AUTO-03`, P1):** Tái kiểm tra chủ sở hữu (`users.status = 'active'`), thành viên tổ chức (`organization_members`), trạng thái/generation của credential đã ghim và phạm vi bảng (`boardIds`) ngay trong hàm nguyên tử `claimAndRevalidateBeforeSend` trước khi phát lệnh gửi ra ngoài.
5. **`TRELLO-AUDIT-08` (`AUTO-04`, P2 — phía API/runner):** Kiểm tra nghiêm ngặt biên nhận trả về từ Slack (`ts` phải là chuỗi khác rỗng, không phải `'undefined'`/`'null'`) và Telegram (`messageId` phải là số nguyên dương); biên nhận thiếu hoặc sai định dạng chuyển thành `delivery_unknown` / `needs_attention`.
6. **`TRELLO-AUDIT-09` (`AUTO-05`, P2):** Khi `includeAiSummary: false`, không gọi LLM (`0` lượt gọi). Khi bật `includeAiSummary`, làm sạch tiêu đề bảng/thẻ bằng `sanitizeUntrustedTrelloText`, bọc trong `<trello_data>...</trello_data>` (`buildTrelloAiPromptPayload`), và kiểm chứng đầu ra bằng `isGroundedTrelloAiSummary` (bác bỏ mọi con số tự bịa hoặc khẳng định đầy đủ 100%, tự động dùng bản tóm tắt tất định có căn cứ).
7. **`TRELLO-AUDIT-10` (`AUTO-06`, P2):** Mở rộng `ScheduleService.resolveRunDelivery` (`mark_sent` và `retry_new_run`) cho `trello_digest` và `telegram_digest` với kiểm tra chủ sở hữu, bắt buộc `confirmDuplicateRisk: true`, kiểm tra bất biến cấu hình gốc (`digest_config` / `digest_config_hash` và `run.schedule_version === schedule.version`), chặn retry khi lịch đang tạm dừng (không tiêu tốn token), và đảm bảo giải quyết đồng thời chỉ thành công một lần qua CAS `delivery_resolution IS NULL`.
8. **`TRELLO-AUDIT-11` (`AUTO-07` / `PROD-01`, P2):** Tách giờ chạy lịch (`8h`, `08:00`, `8 giờ sáng`) khỏi cửa sổ hạn thẻ (`dueSoonHours`) trong `evaluateTrelloDigestCandidate`; tôn trọng cửa sổ hạn tường minh (`48 giờ` / `48h`).
9. **`TRELLO-AUDIT-12` (`AUTO-08`, P2):** Hiển thị hạn thẻ theo múi giờ định danh của lịch (`formatDueInTimeZone`) thay vì cắt chuỗi UTC ISO `.slice(0, 16)`.
10. **`TRELLO-AUDIT-14` (`AUTO-10`, P1):** `TelegramDigestRunner` ghi nhận khóa bền vững nguyên tử `delivery_started_at` TRƯỚC khi gửi mạng (không giữ khóa dòng DB qua mạng, không dựa vào mutex bộ nhớ), chặn gửi trùng giữa hai tiến trình OS hoặc hai `ScheduleRunner`.
11. **`TRELLO-AUDIT-15` (`AUTO-11`, P1):** Khi lệnh gửi `telegram_digest` gặp timeout `AbortSignal` sau khi server nhận POST, lỗi mạng hoặc biên nhận `UNKNOWN`, giữ nguyên `delivery_started_at`, trả về `delivery_unknown`, chuyển lịch sang `needs_attention` (không tự động phát lại qua `replan`), và không để thao tác tạm dừng/hủy/đổi phiên bản lịch xóa mất kết quả `digest_sent` hoặc `delivery_unknown`.
12. **`TRELLO-AUDIT-16` (`AUTO-12` / `PROD-02`, P2):** Khi người dùng yêu cầu tên bảng không tồn tại hoặc trùng tên trong `evaluateTrelloDigestCandidate`, trả về `canAutoDigest: false` kèm `disabledReason` thay vì âm thầm lấy 5 bảng đầu tiên.
13. **`TRELLO-AUDIT-17` (`AUTO-13`, P2):** Bước kiểm tra kênh đích `slack.search_channels` trong `trello-digest-runner.ts` đóng an toàn (fail-closed) khi gặp lỗi ngoài nhóm auth hoặc phản hồi không phải mảng.
14. **`R1` (Rủi ro điều kiện đa bản sao):** Ghi rõ giới hạn single-instance và hành vi fail-closed của `TrelloTokenManager` trong `apps/chat-api/src/services/trello/token-manager.ts`.

## Kết quả kiểm thử thực tế

- **RED Delivery Invariants:** `10 failed (10)`, exit code `1` (`red-delivery-invariants.log`)
- **GREEN Delivery Invariants:** `10 passed (10)`, exit code `0` (`green-delivery-invariants.log`)
- **RED Accuracy & Coverage:** `5 failed (5)`, exit code `1` (`red-accuracy-coverage.log`)
- **GREEN Accuracy & Coverage:** `5 passed (5)`, exit code `0` (`green-accuracy-coverage.log`)
- **Hồi quy Trello & Telegram (10 file):** `102 passed (102)`, exit code `0` (`adjacent-regressions.log`)
- **Hồi quy Schedule Runner dùng chung (4 file):** `39 passed (39)`, exit code `0` (`adjacent-shared-schedule-regressions.log`)
- **Hồi quy Sheets, Calendar, Scope Guard & Telegram Proposal (5 file):** `55 passed (55)`, exit code `0` (`adjacent-sheets-calendar-recovery.log`)
- **Typecheck (`npm run typecheck:v3`):** PASS, exit code `0` (`typecheck.log`)
