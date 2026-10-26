# 26/10/2026 · OAUTH-01 · Sửa sau review độc lập lần 1 (#172)

**Người viết:** reviewer (bên thi công). **Nhánh:** `feat/oauth-01-connect-from-chat`, sửa trên head `2c57d35`. Review độc lập lần 1 tại `2c57d35`: **chưa đạt**, 1 P2 và 1 P3. Log thi công: [OAUTH-01](2026-10-26-reviewer-OAUTH-01-connect-from-chat.md).

## Hai lỗi của review và cách sửa

Cả hai đều đúng như mô tả. Mỗi lỗi có test RED trước khi sửa.

1. **P2: luồng mới vẫn bật khi `GMAIL_ENABLED=off`.**
   - Cockpit luôn truyền `onResend` và `onRefreshServices`, còn `RefusalMoment` không biết cờ. Mở lại một lời từ chối cũ vì Slack chưa cấu hình, sau khi Slack đã được cấu hình, thì màn mời "Gửi lại yêu cầu", bỏ nút "Kết nối Slack", và mỗi lời từ chối gọi thêm `GET /api/services`. Đặc tả mục 2 yêu cầu cờ tắt thì hệ thống không đổi.
   - **Sửa:** `Cockpit` lấy `gmailEnabled` từ cùng lời gọi `getRuntime()` đã có (dùng cho `runtimeMode`) và truyền `connectFromChat={gmailEnabled}`. `RefusalMoment` chỉ bật phần OAUTH-01 khi `connectFromChat`: đọc lại dịch vụ, coi dịch vụ đã dùng được, "Gửi lại yêu cầu", nhãn "Cần kết nối lại", và nút Gmail đi thẳng sang Google. Cờ tắt (mặc định `false`) thì màn giống bản `main`: mọi dịch vụ trong lời từ chối ghi "Chưa kết nối", nút Gmail chuyển trang tới `/settings#gmail`.
   - Khác bản `main` khi cờ tắt chỉ còn hai lớp CSS ở nhãn trạng thái (`min-w-0 break-all` và `flex-shrink-0` ở chấm màu), để email dài không tràn khi cờ bật. Khi cờ tắt, nhãn chỉ là một trong bốn chữ ngắn có sẵn.
2. **P3: ràng buộc DB thiếu phần `mode = 'connect_gmail'` của đặc tả 4.1.**
   - PostgreSQL nhận `return_to` trên state `login` và `link`. Route chỉ ghi trường này ở luồng Gmail nên chưa khai thác được, nhưng thiếu bất biến so với thiết kế.
   - **Sửa theo hướng reviewer đề xuất:** ràng buộc `oauth_states_return_to_check` trở lại đúng đặc tả 4.1, có `mode = 'connect_gmail'`. Test cũ `gmail-migration.test.ts` ("runs the whole migration set again…") đổi từ "đúng 2 ràng buộc CHECK có chữ `mode`" sang "đúng tập tên `oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check`". Ý của test giữ nguyên và chặt hơn: bản trùng không tên vẫn làm tập tên khác đi, và test nay kiểm cả tên.
   - **Cần nhóm trưởng xác nhận** việc sửa assertion cũ này. Đây là assertion cũ duy nhất PR sửa.

## Sửa thêm: lỗi OID chập chờn của cùng test

Cùng câu truy vấn đó gọi `pg_get_constraintdef` trên ràng buộc của mọi schema trước khi lọc theo schema của test, nên đụng bảng mà file test khác vừa xoá (`could not open relation with OID …`, mục 5 của CURRENT-STATE). PR này thêm một file migration chạy DDL song song, nên lỗi hay gặp hơn. Câu truy vấn nay lọc theo schema trong một truy vấn con có `OFFSET 0` (rào cho planner) rồi mới gọi `pg_get_constraintdef`.

Chạy song song ba file `gmail-connections`, `oauth-return-to-migration`, `gmail-migration`:
- trước khi sửa: 4/13 lượt gặp lỗi OID (gộp các lần đo trong phiên: 2/5, 1/2, 1/6);
- sau khi sửa: 0/12 lượt có lỗi, mỗi lượt 33/33.

## RED → GREEN

PostgreSQL 16 tmpfs riêng ở 56533, dựng lại sạch trước mỗi lượt cuối. Log ở `.codex/oauth01/review1-*.log`.

| Test | RED trên `2c57d35` | GREEN |
|---|---|---|
| `oauth-01-flag.test.tsx` (mới, 3 ca): render `Cockpit` thật, lời từ chối qua `handleSSEEvent`, cờ lấy từ `getRuntime` | 2 ca cờ tắt fail (`expected <button …> to be null`: vẫn có "Gửi lại yêu cầu"); ca cờ bật đạt | 3/3 |
| `oauth-return-to-migration.test.ts`: `login`/`link` có `return_to` phải bị từ chối | 2 fail (`promise resolved … instead of rejecting`) | 2/2 |
| `gmail-migration.test.ts` sau khi đưa `mode` vào ràng buộc | 1 fail (`expected [ …(3) ] to have a length of 2 but got 3`) | đạt sau khi đổi assertion sang tập tên |

Hai test unit cũ của OAUTH-01 (`oauth-01-refusal.test.tsx`) render `RefusalMoment` trực tiếp nên được truyền thêm `connectFromChat` (cờ bật); assertion của chúng không đổi. Web 5 file liên quan: 79/79.

## Đột biến

`.codex/oauth01/mutate.mjs`, chạy lại toàn bộ trên mã mới (`mutations-review1.log`): **26/26 bị bắt**. Gồm 20 đột biến cũ (chỉ cập nhật chuỗi neo theo mã mới, trừ O19 ở browser) và 6 đột biến mới:

| # | Đột biến | Test bắt |
|---|---|---|
| R1 | Cockpit luôn bật luồng mới (`connectFromChat` cố định) | 2 ca cờ tắt của `oauth-01-flag` |
| R2 | coi dịch vụ đã dùng được khi cờ tắt | 2 ca cờ tắt |
| R3 | đọc lại dịch vụ khi cờ tắt | cả 3 ca (cờ bật: đọc lại 2 lần thay vì 1) |
| R4 | nút Gmail sang Google khi cờ tắt | ca Gmail cờ tắt |
| R5 | Cockpit bỏ qua `gmailEnabled` của `/api/health` | ca cờ bật |
| R6 | ràng buộc migration bỏ phần `mode` | 2 ca migration |

O19 (`Workspace` không nối `onRefreshServices`) đã bắt ở browser trên head trước; `Workspace.tsx` không đổi trong lượt sửa này.

## Kiểm toàn bộ

- `npm run check` trên DB tạm dựng lại sạch: **exit 0**, 63 + 408 + 359 + 42 + 554 + **792** = **2.218 v3** + **394 eval** (web thêm 3 ca của `oauth-01-flag`). Log: `.codex/oauth01/check-review1.log`.
- `npm run test:browser:v3` trên DB tạm dựng lại sạch, cổng 3999/5199: **exit 0 ngay lượt đầu**, **124 pass/1 skip có chủ đích, 13 nhóm** (default 93, `gmail` 8). Log: `browser-review1.log`.
- `npm run typecheck:v3` exit 0.

## Chưa làm

- Không gọi Google thật (đi cùng GMAIL-04).
