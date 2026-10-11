# FE-11 · Dọn lỗi frontend sau FE-05 → FE-09

- Ngày: 10/10/2026, Asia/Saigon.
- Task: [FE-11](../tasks/FE-11-frontend-bugfixes.md).
- Nhánh: `fix/fe-11-frontend-bugfixes`; base `d319a32` (`main` sau task card FE-11).
- Phạm vi: hoàn thành A1, B1–B4, C1–C7. Không làm D1/D2 tùy chọn. Không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md`.

## Thay đổi

- Auth return target dùng `sessionStorage`, kiểm tra đường dẫn nội bộ, loại route tài khoản, consume một lần và kiểm tra cùng user khi phiên cũ xác định được chủ sở hữu. Password login và Google callback đều khôi phục đích; active logout xóa đích. `storage` event phân biệt đăng xuất tab khác với refresh/session expiry.
- UUID sai định dạng dừng tại repository trước khi tới cột PostgreSQL `uuid`. `ConversationRepo` và `PlanRepo` trả not-found nhất quán; memory repository vốn đã có hành vi tương đương. HTTP integration test bao phủ 14 route ID trong task card.
- Frontend mã hóa conversation ID cho detail/message/plan/execution/SSE; 500 có thông báo máy chủ, lỗi fetch và 502/503/504 có thông báo kết nối; NotFound có một `h1`; PlanningError dùng trạng thái network thật.
- Structured clarification reason đi qua tool schema, planner, persisted message/SSE và hydration frontend. Structured metadata được ưu tiên, regex chỉ giữ tương thích dữ liệu cũ.
- Regression: hai nhánh bảo vệ hydrate history, Back sau create failure, `openWhenHidden`, và Google config race đều có test riêng.

## TDD và kiểm chứng

| Hạng mục | RED trước sửa | GREEN cuối |
|---|---|---|
| A1/C3 auth return + cross-tab | module return-target chưa tồn tại; storage event không phát auth change | nhóm auth/storage 17/17; browser FE-11 1/1 |
| B1 UUID | 2 repository test đi tới query PostgreSQL giả và fail | repository + PostgreSQL HTTP 17/17; 14 endpoint malformed đều 404 |
| B2–B4/C2 | 5 assertion fail: câu 500 sai, thiếu h1, network title sai, URL chưa encode | 5/5 |
| C1 reason | planner 6 fail; API SSE 1 fail; frontend 2 fail | schema/planner/API/frontend focused đều pass; planner full pass |
| C4 hydrate | bỏ riêng điều kiện `messages` làm ca messages-only fail; bỏ riêng `planRevision` làm ca revision-only fail | `fe-06b-responses` 28/28 |
| C5 history | create failure tạo thêm route nháp nên Back sai | `app-safety` pass với c2 → c1 → New fail → Back c2 |
| C6 SSE hidden | đổi `openWhenHidden` thành `false` làm test fail | test hidden/visibility pass |
| C7 Google | test cũ phụ thuộc timeout mặc định; ca mới chờ request `/api/auth/config` | 20/20 lượt, mỗi lượt 41/41 (820 executions) |

Các lệnh thực tế:

- `npm run typecheck:v3`: exit 0.
- Focused frontend FE-11: 60/60.
- Focused API với `.env` và PostgreSQL thật: 17/17.
- `npm run check`: exit 0; tool-schemas 47, adapters 340, planner 212, executor 25, API 371, web 663, eval 173; build, build-security, launcher 1 và env/OIDC 10 đều pass.
- `npm run test:browser:v3`: exit 0; 98 pass, 1 skip, 11 scenario. Lần đầu bị chuỗi lỗi fixture vì `CHAT_ADMIN_*` trong DB cục bộ có role `member`; xác minh trực tiếp DB, chạy `npm run admin:provision:local:v3`, sau đó toàn suite pass. Không sửa product để che lỗi setup.
- Visual evidence runner trên base và head: 4/4 mỗi phía. Worktree base tạm đã xóa; ảnh không nằm trong Git.

## Bằng chứng ảnh trước/sau

Thư mục ngoài repo: `D:\ATI_Project\fe11-screenshots`. Mỗi màn hình có 1440×900 và 375×900, light/dark. SHA256:

| Ảnh | Before | After |
|---|---|---|
| not-found 1440 dark | `44697bffe49614f0f8685c552e47c6987893a1db2599d440a3274e0bd58cc930` | `9fc8131902132195b315c390028a85b9eea14d703726d0cabb048f5e823ab79c` |
| not-found 1440 light | `be0ce30fa0f261cf59f0aeab3c7c879361d1db394093ce1cd37d6b9e045a5d50` | `ed3c30e5101951bf1a9bbadd2ca9d086246575d13c99c97a53499d679bd9a9fd` |
| not-found 375 dark | `9464e170d0499c9a5c9be8961fb2db9d78006e4b0d7f23097c48fcc3931d770b` | `26d670b78b79fc1555f9c6748e276b1f5f53f107058587f39403f0a653c04a3c` |
| not-found 375 light | `699b74315b70cf451644608b1cc88b99a25df35920346b961336ed185252140d` | `8058d35b6f6ad80875d35ebd8cba7bf3a5dfbc076ee08dfcb536c6e7454e8529` |
| planning-error 1440 dark | `79dfa51e47c9f9aa8a5ca78e330fdeb494f917f720475a29afd3075078a9c598` | `b0f66bd99143ebbedb0ea37705af3e252537ea53c2e745aa47671c62eca5760c` |
| planning-error 1440 light | `3a4eb91086c9668bbbc996ea2183dd8259ea6d634c70f48f05f0e8232f371f8f` | `f492d9462e4ce069ef1b202bd2a635de1331cabd7120bf0208ffc8feb01b6920` |
| planning-error 375 dark | `291db1acd2d8d0e0db6db61a7fe0a616b06896033e991ae25a459b505b0bbc7e` | `fbd0b15057ffd1c7bddbf3f4803b437ce215a21d5ec05117701bd4d22ef0ea23` |
| planning-error 375 light | `7bc2549694cfbca9e33153fe1eeeafe4b2e15867a5e35cd8c58354ef4a58eab6` | `3028db4bc9fe505bdcd741b536a07945f73d793c2e2836e10ae23ee772390504` |

Đã xem trực tiếp các cặp mobile light: NotFound sau sửa có `h1`; PlanningError sau sửa dùng “Mất kết nối máy chủ” khi `navigator.onLine=false`, trong khi base luôn ghi “Sự cố máy chủ”.

## Lưu ý

- Build vẫn cảnh báo main chunk 781,33 kB; D1 code splitting là tùy chọn và chưa làm.
- PostgreSQL/Docker local còn chạy để phục vụ phát triển; không xóa dữ liệu hay tắt môi trường của người dùng.
