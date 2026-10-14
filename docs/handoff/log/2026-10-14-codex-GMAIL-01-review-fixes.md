# 14/10/2026 · GMAIL-01 · Sửa P2 số 1 và 2 của review #140

- PR: [#140](https://github.com/VinhDat267/ATI_Project/pull/140), nhánh `feat/gmail-01-personal-connection`.
- Yêu cầu: sửa hai race trong [review độc lập](https://github.com/VinhDat267/ATI_Project/pull/140#issuecomment-6161726666), giữ kết nối của callback lưu thành công trước; không cho logout/disable xen giữa kiểm phiên và INSERT; không thu hồi grant có thể dùng chung với kết nối đang hoạt động.
- Lỗi số 3 đã sửa ở `6e82c00`, giữ nguyên trong lượt này (sau rebase là `7849f43`). GMAIL-02 chưa viết code, vẫn chờ #140 merge.
- Rebase lên `main` `b9ceaee`, không xung đột. Commit mã được kiểm: `c420cfdf5892087647f2c151341d5b6f1efb70b3`.

## Thay đổi

Chỉ hai file production:

- `apps/chat-api/src/db/repositories/gmail-connection-repo.ts`:
  - lưu thành công xoá mọi state `connect_gmail` của chính người đó trong cùng transaction, nên cả callback đang chạy lẫn flow chưa bắt đầu không thể thay kết nối đã lưu; state của người khác không bị xoá;
  - thứ tự khoá advisory Gmail → hàng user → hàng session, giữ tới COMMIT/ROLLBACK; logout và disable phải có thứ tự với lần lưu;
  - lấy thời gian từ clock của callback ngay trước INSERT, sau cả DELETE có thể chờ khoá; nếu phiên đã hết hạn, rollback khôi phục credential và các state cũ;
  - `withLockedConnection` giữ quyết định thu hồi ổn định bằng advisory, user và credential row lock. Khoá user cũng chặn INSERT state mới qua FK; đếm cả flow khác chưa dùng và đã dùng state, bỏ qua riêng state của callback bị từ chối.
- `apps/chat-api/src/routes/connections/gmail.ts`:
  - không thu hồi khi còn flow khác có thể đang giữ chung grant;
  - không thu hồi khi đã có kết nối mà địa chỉ trùng, chưa biết địa chỉ, hoặc config hiện tại không đọc được;
  - khi không còn flow cạnh tranh, chỉ thu hồi nếu không có kết nối hoặc đã xác minh là mailbox khác. Google request vẫn có AbortSignal và giới hạn 10 s; lỗi nền không chứa token;
  - callback chưa bắt đầu sau lần lưu khác bị từ chối trước đổi code, không gọi token/revoke.

## RED → GREEN

Lấy đúng hai file test từ `wip/gmail-01-review-tests` tại `24562f1` bằng `git cherry-pick --ff`: commit chỉ chứa `tests/db/gmail-connection-repo.test.ts` và `tests/routes/gmail-connections.test.ts`. Sau rebase, commit nhập test là `79ce008`; patch-id bằng commit gốc: `97b68cd90a8b6aae78f937a7732b4914ba7b9e4c`.

| Giai đoạn | Output thật | Exit |
|---|---|---:|
| Hai file nguyên trạng từ `24562f1`, trước sửa production | 4 fail / 24 pass (28) | 1 |
| Thêm disable, callback chưa bắt đầu, profile/scope lỗi giữ grant; hai callback in-flight | 8 fail / 24 pass (32) | 1 |
| Bản sửa đầu tiên | 32/32 pass | 0 |
| Thêm expiry lúc DELETE chờ khoá và flow khác giữ chung grant, trước sửa hai cạnh này | 2 fail / 34 pass (36) | 1 |
| Bản sửa cuối và thêm kiểm consumed flow/FK state insertion | 38/38 pass | 0 |

Đổi fixture của hai ca grant từ commit gốc: bắt đầu callback chậm và chờ máy chủ HTTP giả xác nhận đã nhận token exchange, rồi cho callback kia lưu trước. Nếu state của callback chưa bắt đầu đã bị vô hiệu hoá thì không có refresh token để thu hồi; giữ kỳ vọng "thu hồi grant riêng" ở ca thực sự đã đổi code. Giữ các assertion không ghi đè kết nối và không thu hồi grant chung. Thêm ca riêng callback chưa bắt đầu → từ chối, 0 token exchange/revoke; không sửa assertion browser hay test trước GMAIL-01.

Concurrency dùng PostgreSQL thật: giữ row/advisory lock, quan sát `pg_stat_activity`, rồi logout/disable hoặc tiến clock trong lúc thao tác ghi chờ. Test thu hồi dùng máy chủ Google giả HTTP thật, đếm request revoke. Không mock trạng thái phê duyệt.

## Đột biến

Chạy tuần tự 22 ca, mỗi ca exit 1 vì test thất bại, rồi khôi phục đúng SHA256 của source. Script tổng hợp exit 0: `caught: 22, total: 22, restored: true`.

| ID | Đột biến | Test fail |
|---|---|---:|
| M1 | bỏ ràng buộc người/phiên trong state | 2 |
| M2 | bỏ ràng buộc mode | 3 |
| M3 | personal credential rơi về hàng NULL | 1 |
| M4 | cache Gmail theo tên dịch vụ | 1 |
| M5 | bỏ so credentialId | 4 |
| M6 | giữ connections của model | 2 |
| M7 | bỏ kiểm quyền gmail.modify | 2 |
| M8 | bỏ Gmail khỏi isWriteTool catalog | 5 |
| M9 | bật Gmail khi không đặt cờ | 2 |
| M9b | gắn route khi cờ tắt | 1 |
| X1 | giữ connections trong lịch sử model | 1 |
| X2 | bỏ lượt làm mới token chung | 2 |
| X3 | bỏ kiểm state/session và expiry khi lưu callback | 9 |
| N1 | không vô hiệu hoá các flow còn lại khi lưu | 4 |
| N2 | bỏ user row lock ở save | 2 |
| N3 | bỏ session row lock ở save | 1 |
| N4 | thu hồi dù địa chỉ trùng kết nối hiện tại | 1 |
| N5 | thu hồi khi chưa biết địa chỉ grant bị từ chối | 2 |
| N6 | bỏ advisory và user lock của quyết định cleanup | 2 |
| N7 | bỏ kiểm expiry ngay trước INSERT | 2 |
| N8 | không chặn INSERT state mới qua user FK trong cleanup | 1 |
| N9 | chỉ đếm flow chưa dùng, bỏ sót flow đã đổi token | 1 |

X3 bỏ cả guard row rỗng và guard expiry mới để mô phỏng việc chấp nhận callback không hợp lệ; nếu chỉ bỏ guard row rỗng, truy cập expiry của row thiếu vẫn từ chối bằng lỗi khác. Các ca còn lại sửa đúng một chốt, N6 tháo hai khoá bảo vệ cùng quyết định.

## Kiểm tra và review

- Worktree riêng, không `.env`; PostgreSQL 16 tmpfs riêng `ati-pr140-p2-20261014` tại `127.0.0.1:56533`; migration 0001–0009 exit 0; không dùng/xoá PostgreSQL của người dùng ở 55533 hoặc volume dev. `RUNTIME_MODE=sandbox`, cờ Gmail và read answers tắt.
- `npm run check`: exit 0, **1.811 v3** = 63 schema + 340 adapter + 240 planner + 36 executor + 453 API + 679 web; **173 eval** (routing offline 116 câu); typecheck/build, quét build, launcher 1/1, env/OIDC 10/10 đạt.
- Reviewer độc lập rà diff, không còn finding trong phạm vi P2 số 1 và 2; tự chạy lại hai file test trên head `c420cfd`: **38/38 pass, exit 0**. HEAD và hash source không đổi trước/sau, Git sạch.
- `npm run test:browser:v3`: **exit 0**, **101 pass, 1 skip có chủ đích**, 11 nhóm; không sửa assertion cũ.
- Hash sau review và sau khôi phục đột biến:
  - `gmail-connection-repo.ts`: `5AE0F6B15AEF79C35333280EEB89EFA1C4EF601A96CC5236FCA1C8088F36677A`;
  - `routes/connections/gmail.ts`: `B86D0F35F2FAFEDBBDC1F2771FF2E6359DA5A639AE55A1F8A842CF644AF6DFA5`.
- Bằng chứng riêng và script đột biến ở `.codex/gmail01-review-fix/` (ignored), gồm RED/GREEN, check/browser, independent-focused và mutation summary. Không commit log đột biến thô vì assertion có thể in dữ liệu OAuth của fixture.

## Giới hạn và bàn giao

- Không gọi Google thật hoặc model; dùng Google HTTP giả và transport sandbox. Không triển khai adapter Gmail của GMAIL-02.
- Không sửa CURRENT-STATE hoặc ROADMAP; không merge PR. CI head sau push và xoá nhánh WIP sẽ được báo trong #140.
- Dữ liệu `PRODUCT.md` và `skills-lock.json` ở workspace chính được giữ nguyên; worktree/evidence cũ được giữ.
