# TRELLO-V3-B · Khắc phục Backend cho Trello & Telegram Digest (Owner B)

**Trạng thái:** Hoàn thành (RED → GREEN trên PostgreSQL 16 cô lập) · **Nhánh:** `VinhDat267/fix-trello-digest-v3` · **Baseline SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`

## Mục tiêu

Khắc phục 13 phát hiện chuẩn tắc thuộc phạm vi Backend (`apps/chat-api/**` và `packages/tool-schemas/src/types.ts` additive) từ đợt kiểm toán `trello-v3-20261110-2eed8d1d`:
- **TRELLO-AUDIT-03 (`F3`, P2, phía API):** Bảo toàn trạng thái `reconciliation_required` cho step `unknown` trong `ExecutionService.getExecutionStatus`.
- **TRELLO-AUDIT-05 (`AUTO-01` / `PROD-03`, P2, phía API/renderer & `types.ts`):** Loại trùng `card.id`, tách bạch `scannedCount` (50/bảng), `uniqueScannedCount`, `duplicateCountDropped`, `matchedCounts` thực tế trên tập đã quét và `displayedCounts` (tối đa 15/nhóm), báo cáo `totalAvailable: 'UNKNOWN'`, `isComplete: false` trong `TrelloDigestDelivery.coverage`, hiển thị cảnh báo giới hạn quét ngay cả khi 0 thẻ khớp, cắt dòng an toàn ở mốc 3.500 ký tự mà không cắt ngang URL/dòng hay xóa cảnh báo độ phủ, đồng thời tương thích với `(cards as any)?.scanMetadata` của Worker A.
- **TRELLO-AUDIT-06 (`AUTO-02`, P1):** Truyền ngữ cảnh workspace tin cậy (`workspaceMode`, `workspaceId`) từ `RunToPlan` / `ChatService` xuống đánh giá ứng viên lịch, `trelloConnection`, `AdapterFactory` và runner; không bao giờ tự rơi về `'default'` hoặc thông tin xác thực chia sẻ không gắn phạm vi cho lượt chạy tổ chức (`organization`).
- **TRELLO-AUDIT-07 (`AUTO-03`, P1):** Tái xác thực quyền sở hữu (`users.status = 'active'`), tư cách thành viên tổ chức (`organization_members`), trạng thái/generation của credential đã ghim và phạm vi bảng (`boardIds`) ngay trong biên giới bền vững trước khi gửi (`claimAndRevalidateBeforeSend`); thu hồi giữa lúc đọc nguồn và lúc gửi đi sẽ chặn gửi (`0` lệnh gửi).
- **TRELLO-AUDIT-08 (`AUTO-04`, P2, phía API/runner):** Biên nhận gửi thiếu hoặc sai định dạng từ Slack (`ts` rỗng/không phải chuỗi hợp lệ/`'undefined'`/`'null'`) hoặc Telegram (`messageId` thiếu/không phải số dương) bị phân loại là `delivery_unknown` / `needs_attention`, không bao giờ báo `digest_sent`.
- **TRELLO-AUDIT-09 (`AUTO-05`, P2):** Khi `includeAiSummary: false`, tuyệt đối không gọi LLM (`0` lượt gọi). Tiêu đề bảng/thẻ không tin cậy được làm sạch (`sanitizeUntrustedTrelloText`), giới hạn độ dài và cô lập trong `<trello_data>...</trello_data>` (`buildTrelloAiPromptPayload`). Mọi tuyên bố số liệu hoặc khẳng định đầy đủ 100% không có căn cứ từ LLM đều bị bác bỏ (`isGroundedTrelloAiSummary`) và chuyển về bản tóm tắt tất định có căn cứ.
- **TRELLO-AUDIT-10 (`AUTO-06`, P2):** Mở rộng `ScheduleService.resolveRunDelivery` (`mark_sent` và `retry_new_run`) cho `trello_digest` và `telegram_digest` với ảnh chụp cấu hình gốc bất biến (`digest_config` / `digest_config_hash`, kiểm tra `run.schedule_version === schedule.version`), kiểm tra chủ sở hữu, bắt buộc `confirmDuplicateRisk: true` khi tạo lượt chạy mới, từ chối retry khi lịch đang tạm dừng (không tiêu tốn token), và đảm bảo giải quyết đồng thời chỉ thắng một lần qua CAS `delivery_resolution IS NULL`.
- **TRELLO-AUDIT-11 (`AUTO-07` / `PROD-01`, P2):** Tách biệt giờ chạy lịch (`8h`, `08:00`, `8 giờ sáng`) khỏi cửa sổ hạn thẻ (`dueSoonHours`) trong `evaluateTrelloDigestCandidate`; giữ nguyên cửa sổ hạn tường minh (`trong 48 giờ tới` → `48`).
- **TRELLO-AUDIT-12 (`AUTO-08`, P2):** Định dạng hạn thẻ theo đúng múi giờ định danh của lịch (ví dụ `Asia/Ho_Chi_Minh`) thay vì cắt chuỗi UTC ISO `.slice(0, 16)`.
- **TRELLO-AUDIT-14 (`AUTO-10`, P1):** Hai tiến trình hệ điều hành thực tế hoặc hai `ScheduleRunner` chạy cùng một `schedule_runs` của `telegram_digest` ghi nhận khóa bền vững nguyên tử `delivery_started_at` TRƯỚC khi gửi mạng (không dùng mutex bộ nhớ làm nguồn sự thật, không giữ khóa dòng DB qua mạng), đảm bảo chỉ 1 lượt gửi ra ngoài.
- **TRELLO-AUDIT-15 (`AUTO-11`, P1):** Lượt gửi `telegram_digest` gặp timeout `AbortSignal` sau khi server đã nhận POST, lỗi rớt mạng hoặc biên nhận `UNKNOWN` giữ nguyên `delivery_started_at`, trả về `delivery_unknown`, chuyển lịch sang `needs_attention` (không tự động phát lại qua `replan`), và việc tạm dừng/hủy/đổi phiên bản lịch trong lúc đang gửi không bao giờ xóa kết quả `digest_sent` hay `delivery_unknown`.
- **TRELLO-AUDIT-16 (`AUTO-12` / `PROD-02`, P2):** Khi người dùng chỉ định tên bảng không tồn tại hoặc trùng tên mơ hồ trong `evaluateTrelloDigestCandidate`, từ chối tạo lịch tự động (`canAutoDigest: false` kèm `disabledReason` rõ ràng) thay vì âm thầm lấy 5 bảng đầu tiên.
- **TRELLO-AUDIT-17 (`AUTO-13`, P2):** Bước kiểm tra kênh đích (`slack.search_channels`) trong `trello-digest-runner.ts` đóng an toàn (fail-closed) khi gặp lỗi ngoài nhóm auth hoặc phản hồi không phải mảng.
- **R1 (Rủi ro kiến trúc đa bản sao):** Ghi nhận rõ giới hạn single-instance và hành vi fail-closed của `TrelloTokenManager` trong `apps/chat-api/src/services/trello/token-manager.ts`; giữ mở rủi ro điều kiện đa replica mà không viết lại giao thức giả tạo.

## Phạm vi file sở hữu (Owner B)

- `packages/tool-schemas/src/types.ts` (chỉ bổ sung additive cho kiểu digest hiện có)
- `apps/chat-api/src/server.ts`
- `apps/chat-api/src/services/adapter-factory.ts`
- `apps/chat-api/src/services/chat-service.ts`
- `apps/chat-api/src/services/execution-service.ts`
- `apps/chat-api/src/services/schedules/schedule-runner.ts`
- `apps/chat-api/src/services/schedules/schedule-service.ts`
- `apps/chat-api/src/services/schedules/telegram-digest-runner.ts`
- `apps/chat-api/src/services/schedules/trello-digest-candidate.ts`
- `apps/chat-api/src/services/schedules/trello-digest-runner.ts`
- `apps/chat-api/src/services/trello/token-manager.ts`
- `apps/chat-api/tests/helpers/jira-test-db.ts`
- `apps/chat-api/tests/helpers/two-process-digest-worker.ts`
- `apps/chat-api/tests/services/schedules/telegram-digest-cancellation.test.ts`
- `apps/chat-api/tests/services/schedules/trello-digest-accuracy-coverage.test.ts`
- `apps/chat-api/tests/services/schedules/trello-telegram-delivery-invariants.test.ts`
- `apps/chat-api/tests/services/trello-digest.test.ts`

## Kết quả

### 1. Kiểm thử TDD (RED → GREEN) trên PostgreSQL 16 cô lập (`127.0.0.1:61165`, container `ati-trello-remed-b-20261110`)

- **Cụm bất biến gửi, khóa bền vững 2 tiến trình OS, thu hồi quyền trước khi gửi, biên nhận & đối soát (`trello-telegram-delivery-invariants.test.ts` — 10 test):**
  - **RED (trước khi sửa, trên baseline `2eed8d1d`):** `10 failed (10)`, exit code `1`, thời gian `29.04s` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/red-delivery-invariants.log`).
    - Hai tiến trình Node thực tế (`two-process-digest-worker.ts`) cùng chạy một `runId` với cổng chặn HTTP loopback đã phát ra `2` POST trùng lặp.
    - Hai `ScheduleRunner` cùng chạy một `runId` đã phát ra `2` lần gọi `sendMessage`.
    - Timeout `AbortSignal` sau khi server nhận POST làm mất `delivery_started_at` và cho phép phát lại tạo bản sao thứ 2.
    - Biên nhận thiếu/sai định dạng (`ts: undefined`, `messageId: null`) vẫn được đánh dấu `digest_sent`.
    - Tạm dừng lịch trong lúc đang gửi ghi đè kết quả gửi thật thành `skipped_cancelled`.
    - `resolveRunDelivery` từ chối `trello_digest` và `telegram_digest`.
    - Lượt chạy `organization` không có kết nối workspace tự rơi về credential cá nhân (`'default'`).
    - Thu hồi quyền sở hữu/thành viên/credential/phạm vi bảng sau bước đọc nguồn vẫn gửi tin nhắn ra ngoài.
    - Lỗi mạng ở `slack.search_channels` bị bỏ qua (fail-open) và vẫn gửi vào kênh.
  - **GREEN (sau khi sửa):** `10 passed (10)`, exit code `0`, thời gian `17.00s` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/green-delivery-invariants.log`).

- **Cụm độ chính xác ứng viên lịch, độ phủ 50 thẻ/15 thẻ, múi giờ & chống bịa đặt AI (`trello-digest-accuracy-coverage.test.ts` — 5 test):**
  - **RED (trước khi sửa, trên baseline `2eed8d1d`):** `5 failed (5)`, exit code `1`, thời gian `2.62s` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/red-accuracy-coverage.log`).
  - **GREEN (sau khi sửa):** `5 passed (5)`, exit code `0`, thời gian `2.40s` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/green-accuracy-coverage.log`).

### 2. Kiểm thử hồi quy lân cận & Typecheck (`EXIT_CODE=0`)

- **Hồi quy Trello & Telegram (10 file, 102 test):**
  - Lệnh: `npx vitest run tests/services/schedules/trello-telegram-delivery-invariants.test.ts tests/services/schedules/trello-digest-accuracy-coverage.test.ts tests/services/trello-digest.test.ts tests/services/schedules/trello-digest-candidate.test.ts tests/services/schedules/telegram-digest-runner.test.ts tests/services/schedules/telegram-digest-cancellation.test.ts tests/services/schedules/telegram-digest-candidate.test.ts tests/services/schedules/schedule-service-telegram.test.ts tests/routes/schedules-telegram.test.ts tests/routes/trello-oauth.test.ts`
  - Kết quả: `10 passed (10)`, `102 passed (102)`, exit code `0` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/adjacent-regressions.log`).
- **Hồi quy Schedule Runner dùng chung (4 file, 39 test):**
  - Lệnh: `npx vitest run tests/services/schedules/schedule-runner.test.ts tests/services/schedules/schedule-runner-sheets.test.ts tests/services/schedules/schedule-runner-WriteToPlan.test.ts tests/services/schedules/schedule-runner-github.test.ts`
  - Kết quả: `4 passed (4)`, `39 passed (39)`, exit code `0` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/adjacent-shared-schedule-regressions.log`).
- **Hồi quy Sheets, Calendar, Scope Guard & Telegram Proposal (5 file, 55 test):**
  - Lệnh: `npx vitest run tests/services/schedules/sheets-digest-runner.test.ts tests/services/schedules/calendar-digest-runner.test.ts tests/services/schedules/digest-scope-guard.test.ts tests/services/schedules/schedule-service-sheets.test.ts tests/services/chat-service-telegram-schedule-proposal.test.ts`
  - Kết quả: `5 passed (5)`, `55 passed (55)`, exit code `0` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/adjacent-sheets-calendar-recovery.log`).
- **Typecheck toàn bộ v3 (`npm run typecheck:v3`):**
  - Kết quả: PASS, exit code `0` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/typecheck.log`).
- **Kiểm thử Generic Plumbing & Evaluations (`evaluations/generic-plumbing/static-guard.test.ts` & `npx vitest run evaluations --testTimeout=30000`):**
  - **RED (`static-guard.test.ts` trên `905695a6`):** `1 failed | 1 passed (2)` do nhánh `'slack'` trong `schedule-service.ts` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/red-static-guard.log`).
  - **Khắc phục:** Di chuyển logic tạo biên nhận xác nhận gửi (`buildConfirmedTrelloDigestDelivery`) và trích xuất credential đã ghim (`getTrelloDigestPinnedCredentialIds`) sang `apps/chat-api/src/services/schedules/trello-digest-candidate.ts`, giữ nguyên kiến trúc generic của `schedule-service.ts` mà không sửa hay nới lỏng `static-guard.test.ts`.
  - **GREEN (`static-guard.test.ts`):** `2 passed (2)`, exit code `0` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/green-static-guard.log`).
  - **GREEN toàn bộ Evaluations (`npx vitest run evaluations --testTimeout=30000`):** `31 passed (31)`, `500 passed | 1 skipped (501)`, exit code `0` (`D:/ATI-Audits/trello-remediation-20261110/owner-b/green-eval-v3.log`).
- Container Docker kiểm thử tạm thời `ati-trello-remed-b-20261110` đã được dọn sạch (`docker rm -f ati-trello-remed-b-20261110`).
