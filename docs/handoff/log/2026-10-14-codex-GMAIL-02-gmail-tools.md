# 14/10/2026 · GMAIL-02 · Công cụ Gmail theo kết nối cá nhân

- Task: [GMAIL-02](../tasks/GMAIL-02-gmail-tools.md), theo [GMAIL-common](../tasks/GMAIL-common.md) và đặc tả mục 3.10, 4.1–4.5, 6.3 phần 2.
- Nhánh: `feat/gmail-02-gmail-tools`, base `61d3be4`, sau merge GMAIL-01 #140. PR: [#143](https://github.com/VinhDat267/ATI_Project/pull/143).
- Mã sản phẩm cuối: `65e4619`; các commit chính: `73f3b88` adapter/executor, `bc67a0e` grounding/bộ nhớ, `feddc9c` tích hợp/sandbox, `dd80504` sửa review, `08dcca6` nhãn rỗng, `65e4619` chế độ tra cứu cho kịch bản Gmail.

## Đã làm

| Phần | File chính |
|---|---|
| 10 tool, transport HTTP, MIME UTF-8/RFC 2047, reply/forward/draft, giới hạn ký tự và người nhận | `packages/tool-adapters/src/gmail/gmail-adapter.ts`, `mail-format.ts` |
| `requestSent: false` trước lệnh ghi; lỗi sau dispatch không tự gửi lại | `packages/executor/src/runner.ts`, adapter Gmail |
| Google giả: Gmail API, trạng thái lỗi, Retry-After, ghi treo/ngắt mạng, đếm request ghi | `scripts/fake-google-gmail.mjs`, `.d.mts` |
| Người nhận literal, grounding từ câu user/header participants, hỏi lại sau một lượt sửa | `packages/planner/src/validator.ts`, `recipients.ts`, `planner.ts` |
| `observedFields`, kho tiêu đề `__labels` riêng, loại khỏi mọi input provider, prefetch chỉ nhãn | `packages/planner/src/search.ts`, `planner.ts` |
| Catalog/registry opt-in, adapter cá nhân ở cả live/sandbox, không rơi về kế hoạch ghi chung khi Gmail lỗi | `apps/chat-api/src/config/gmail-tools-runtime.ts`, `server.ts` |
| Nhãn tài nguyên/người nhận do server tính | `services/resource-labels.ts`, `chat-service.ts` |
| 8 luồng tiếng Việt, injection trong body/subject, kịch bản tìm rồi trả lời | `sandbox/fake-results/gmail.ts`, `sandbox/scenarios.ts`, `sandbox/index.ts` |

`ALL_TOOLS` vẫn 33 tool, `SERVICE_REGISTRY` vẫn 8 dịch vụ; hai cờ mặc định không đổi. Router không đưa dịch vụ cá nhân vào tập fallback khi câu chưa nhắc Gmail. 116 câu routing cũ giữ nguyên khi cờ tắt; bật Gmail chỉ `rf03` đổi sang Gmail.

## RED → GREEN

| Nhóm | RED đã chạy | GREEN đã chạy |
|---|---|---|
| Adapter + executor ban đầu | 50 fail / 3 pass, exit 1 | hai package 429/429, exit 0 |
| Grounding, bộ nhớ và routing | 12 fail / 13 pass, exit 1 | planner + routing 282/282, exit 0 |
| Sandbox/nhãn xem trước | 3 fail / 1 pass, exit 1 (sau import thiếu module) | API config + tích hợp OAuth/PostgreSQL + nhãn 14/14, exit 0 |
| Sáu lỗi review | 14 fail / 68 pass, exit 1 | 82/82, exit 0 |
| Thread không còn nhãn, Google bỏ trường rỗng | 1 fail, exit 1 | adapter/executor cuối 446/446, exit 0 |
| Sandbox mặc định regex vẫn tìm thư trước khi lập kế hoạch Gmail | 3 fail / 6 pass, exit 1 | config + tích hợp 9/9, exit 0 |

Test tích hợp dùng PostgreSQL 16 thật, schema riêng và Google HTTP giả: A kết nối qua route OAuth, nhận `connections.gmail`/nhãn người nhận do server ghi, duyệt qua HTTP, bước Gmail chạy bằng adapter của A; B chưa kết nối bị từ chối với `unavailableServices` Gmail. Sandbox nhận **0 request Gmail API**. Token manager thật làm mới lỗi 503 trước bước gửi: executor trả `failed`, `requestSent: false`, 0 request ghi.

Test transport giải MIME thực gửi tới máy chủ giả, kiểm subject tiếng Việt/emoji, threading, bản nháp, HTML/đính kèm, giới hạn/cặp UTF-16, error table, abort thật, redirect, và ghi UNKNOWN chỉ nhận một request.

## Review độc lập và sửa

Reviewer dùng worktree detached `3d3072b`, PostgreSQL tmpfs riêng 56633, API 3301/web 5475. Kết luận bản đầu **CHƯA ĐẠT**: 2 P1 và 4 P2.

1. P1: parser coi địa chỉ trong tên hiển thị có dấu ngoặc kép hoặc header CR/LF giả là participant.
2. P1: người dùng gõ `o'connor@example.com` nhưng grounding chấp nhận `connor@example.com`.
3. P2: Gmail trả 401 chắc chắn từ chối, rồi refresh 503 vẫn thành `unknown`.
4. P2: 401 rồi retry quota force-refresh ba lần thay vì một.
5. P2: response 2xx thiếu id/threadId/message vẫn báo gửi hoặc tạo nháp thành công.
6. P2: `modify_thread_labels` trả raw Google Thread, sai output `{ id, labelIds }`.

Tác giả sửa cả sáu bằng RED→GREEN ở `dd80504`. Ca nhãn rỗng bổ sung ở `08dcca6` tiếp tục phần chuẩn hoá Thread; không đổi phạm vi. Máy chủ giả trả Thread với `messages[].labelIds` đúng [hợp đồng Google](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify), adapter tính hợp các nhãn.

Bằng chứng độc lập bản đầu: `npm run check` 1.903 v3 + 173 eval đạt; 92 test trọng tâm đạt; probe biên 2 pass/6 fail, probe response 4 fail. Browser default có 82 pass/1 skip/1 timeout FE-03; chạy riêng lại FE-03 1/1 exit 0, 10 nhóm còn lại 18/18 exit 0. Tổng hợp 101 pass/1 skip, **không** gọi đây là một lượt toàn bộ liên tục đạt. Reviewer không review lại các commit sửa; phần sửa được tác giả kiểm bằng test đỏ/xanh, gate toàn repo và đột biến. Không tự ghi kết luận reviewer đã duyệt bản sửa.

## Đột biến

Chạy từng đột biến trong worktree riêng trên `65e4619`, mỗi lần exit 1 và có test hành vi fail; khôi phục đúng SHA256 của file nguồn. **16/16 bị bắt**; sau khôi phục mã nguồn sạch.

| Đột biến | Test bắt |
|---|---|
| M1 nhận địa chỉ chỉ có trong nội dung/bộ nhớ không tin cậy | `gmail-grounding.test.ts` |
| M2 cho `$ref`/`$template` vào người nhận | `gmail-grounding.test.ts`, gồm tham chiếu hợp lệ tới bước trước |
| M3 bỏ chặn CR/LF | `gmail-adapter.test.ts` |
| M4 gửi lại sau response ghi không đọc được | `gmail-adapter.test.ts`, đếm request ghi |
| M5 bỏ `<search_results>` | `gmail-search.test.ts` |
| M6 cho `search_threads` listable | `gmail-search.test.ts`, kiểm prefetch |
| M7 giữ subject trong observed memory | `gmail-search.test.ts` |
| M8 executor bỏ kiểm requestSent | `gmail-pre-dispatch.test.ts` |
| M9 adapter bỏ dấu chưa gửi | `gmail-adapter.test.ts` |
| M10 trả lại parser header cũ | `gmail-adapter.test.ts`, qua cả validator |
| M11 cắt sai local-part có dấu nháy đơn | `gmail-grounding.test.ts` |
| M12 bỏ đặt lại trạng thái sau 401 bị từ chối | `gmail-adapter.test.ts`, qua executor |
| M13 force-refresh ở mọi retry quota | `gmail-adapter.test.ts` |
| M14 nhận response ghi thiếu trường | `gmail-adapter.test.ts` |
| M15 trả raw Thread từ modify | `gmail-adapter.test.ts` |
| M16 để kịch bản Gmail dùng regex, không qua vòng tìm thư | `gmail-tools.test.ts`, OAuth/PostgreSQL thật |

## Gate tại máy tác giả

Worktree riêng, `npm ci`, PostgreSQL 16 tmpfs 56533, không dùng `.env`; Gmail/Read Answers tắt.

- `npm run check` tại `65e4619`: **exit 0**, **1.922 v3** = 63 schema + 404 adapter + 272 planner + 42 executor + 462 API + 679 web; **173 eval**. Typecheck, build, quét bản build `PASS`, launcher 1/1, env/OIDC 10/10. Thêm 111 test so với base, không sửa assertion cũ.
- `npm run test:browser:v3` tuần tự tại `08dcca6`: **exit 0**, **101 pass/1 skip**, đủ 11 nhóm. Lượt trên head bàn giao cuối được đối chiếu trong bình luận PR, cùng CI đúng head. Chỉnh sau đó ở `65e4619` chỉ chọn vòng search cho kịch bản `gmail`; các kịch bản cũ vẫn dùng chế độ đã cấu hình.

- Lượt check tuần tự tại `dd80504`: exit 0, 1.920 v3 + 173 eval; typecheck/build/security/launcher/native checks đạt.
- Lượt check `08dcca6` khi chạy cùng đột biến lại gặp thứ tự callback disable lệch 0,085 ms; chạy lại tuần tự exit 0, 1.921 v3 + 173 eval. Giữ log lỗi, không sửa test GMAIL-01.
- Lượt chạy đồng thời check/browser trước đó gặp hai lỗi trong test GMAIL-01 cũ: thứ tự callback đo bằng `performance.now` lệch 0,193 ms và truy vấn `pg_get_constraintdef` gặp relation OID đã bị xoá. Chạy riêng lại 20/20 đạt; check tuần tự đạt, không sửa assertion cũ.
- Lượt browser trước khi chạy tuần tự gặp `net::ERR_NO_BUFFER_SPACE` ở FE-06B, 82 pass/1 skip/1 fail. Log lỗi được giữ; không đổi assertion hoặc timeout của test.
- Kịch bản Gmail tại app thật (PostgreSQL 56534, API 3302/web 5476), sau bản sửa và với cấu hình sandbox `regex`: browser đăng nhập → OAuth giả qua API → browser chat tìm luồng → preview → duyệt → biên nhận `completed`; 0 Gmail API request/0 write. Có ảnh preview/receipt. UI kết nối chưa thuộc task này nên dùng route API cho OAuth.
- CI đối chiếu đúng head cuối trong bình luận nghiệm thu của [#143](https://github.com/VinhDat267/ATI_Project/pull/143); không dùng CI của commit cũ để kết luận. Chưa merge.

## Khác với kế hoạch và giới hạn

- Tách helper `config/gmail-tools-runtime.ts` để test đúng hàm server dùng mà không khởi động server khi import. Test executor nằm ở file `gmail-pre-dispatch.test.ts` riêng; hợp đồng `StepRunnerOptions` không đổi.
- Helper bash của skill không khởi động được trên Windows; dùng ledger/command log PowerShell tương đương. Chỉ ảnh hưởng cách ghi bằng chứng.
- Giữ bằng chứng trong thư mục ignore `.codex/gmail-02-20261014/`, gồm output RED/GREEN, check/browser, mutation script/results/SHA256, report/probe reviewer và ảnh app. Không commit bằng chứng riêng tư.
- Không sửa CURRENT-STATE/ROADMAP, UI, nhóm browser Gmail, bộ golden hay hash catalog. Không gọi Google/model thật, không gửi thư thật. GMAIL-03 làm UI; GMAIL-04 làm golden/live/bật cờ.
- `PRODUCT.md` và `skills-lock.json` ở checkout chính giữ nguyên SHA256 trước/sau. Nhánh/worktree thi công được giữ để nhận review; không auto-merge.
