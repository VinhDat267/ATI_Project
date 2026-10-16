# 16/10/2026 · ANS-01 · Bổ sung test sau review và tích hợp GMAIL-02

- Task [ANS-01](../tasks/ANS-01-read-answers.md), PR [#142](https://github.com/VinhDat267/ATI_Project/pull/142).
- [Feedback](https://github.com/VinhDat267/ATI_Project/pull/142#issuecomment-6209257629) trên head `993e485`: Đạt sau khi sửa nhỏ, P2 thiếu test prefetch lỗi và P3 thiếu test continuation on. Mã sản phẩm của hai điều kiện này đã đúng; không đổi chúng để làm test đạt.
- Nhánh `codex/feat-ans-01-read-answers`, rebase từ base `61d3be4` lên `e03a9c8` sau #143/#144. Bốn commit được replay; code tích hợp `13a9dd8`, test review `c7b69be`. Remote cũ trước rebase `993e485fc78217d1f8c5436d96f584751f9668a4`.

## Hai test mới

- `packages/planner/tests/read-answers.test.ts`: prefetch bật, `gatherSearch` nhận AbortSignal thật chưa bị huỷ và ném lỗi thường `invalid_auth`; provider trả answer hai lần. Kiểm đúng một lượt prefetch Slack, model được gọi hai lần rồi trả clarification `read_only` với câu hỏi cũ, không có usedDirectory. Assertion về trạng thái signal nằm ngoài callback bị planner catch.
- Cùng file: khối kết quả tra cứu khi `readAnswers: true` phải có `or an answer` trong phần continuation sau `</search_results>`. Test hash bản off giữ nguyên.

## RED trên đúng mutation của reviewer, GREEN trên mã đúng

Lệnh trong mỗi ca: `npm test -w @wap/planner -- tests/read-answers.test.ts`.

| Source | Output thật | Exit |
|---|---|---:|
| P1: bỏ result/error guard, chỉ còn `if (!signal.aborted) successful.add(...)` | 1 failed / 18 passed (19) | 1 |
| P8: bỏ `, or an answer` khi cờ on | 1 failed / 18 passed (19) | 1 |
| Khôi phục cả hai điều kiện đúng | 19 passed (19) | 0 |

- Thực hiện trước rebase và lặp lại cả hai mutant sau rebase, kết quả như bảng. Mỗi mutation tạm thay riêng một file, khôi phục byte gốc trong `finally` trước lượt kế tiếp/gate. Không sửa assertion của test cũ.
- `npm test -w @wap/planner` trên bản rebase: **291/291**, exit 0, 23 file test. Gồm test W3-10 off, ANS-01, Gmail grounding/search/providerMemory và 116 câu routing.
- Năm mutation ANS-01 ban đầu cũng được chạy lại sau rebase (mỗi mutant exit 1): bỏ data guard **4 fail/15 pass**, dùng lookups model **2 fail/17 pass**, HTML **2 fail/4 pass**, lịch sử không bọc **1 fail/1 pass**, cờ off vẫn nhận answer **1 fail/18 pass**. Source khôi phục trước full check.

## Rebase và bảo toàn tích hợp

- Rebase giải đúng hai xung đột mà reviewer báo:
  - `server.ts`: giữ `runtimePlannerSearchMode(...)`, `runtimeToolCatalog`, registry, factory và nhánh fallback Gmail của main; thêm `readAnswers: env.PLANNER_READ_ANSWERS`.
  - `sandbox/scenarios.ts`: giữ nguyên nhánh Gmail (search rồi plan reply), thêm nhánh answer riêng (search rồi answer, follow-up plan); mỗi nhánh return provider riêng.
- `providerMemory(memory.getAll())` giữ ở cả ba lời gọi model: vòng search, regex lần đầu và regex retry. `recordThreadLabels`, observedFields và grounding người nhận của #143 giữ nguyên.
- `git range-diff 61d3be4..993e485 e03a9c8..HEAD -- apps/chat-api/src/server.ts apps/chat-api/src/sandbox/scenarios.ts` xác nhận chỉ thay ngữ cảnh tích hợp như trên.
- Diff so với main không sửa adapter, executor, CURRENT-STATE hoặc ROADMAP. Không đổi mặc định hai cờ, labels, scorer, timeout hoặc retries.

## Gate trên bản rebase

- PostgreSQL 16 tmpfs riêng `ati-ans01-review-postgres`, loopback 56533, max_connections=200 (cùng dung lượng của gate cục bộ ANS-01 trước); không dùng volume phát triển hoặc DB live. Migration 0001–0009 và admin provisioning exit 0. Shell sandbox, hai cờ off; scenario answer do runner bật riêng.
- Hai lượt full check đầu cùng source exit 1: mỗi lượt **1 fail/1.952 pass** v3, duy nhất test có sẵn `gmail-connection-repo.test.ts:182`, `orders ... after the save, never between its check and insert`: lượt 1 nhánh disable, `expected 3917.989 to be greater than 3918.059`, lệch **0,070 ms**; lượt 2 nhánh logout, `expected 4511.165 to be greater than 4511.3113`, lệch **0,1463 ms**. Cùng lỗi mốc promise đã ghi trong CURRENT-STATE/log #143. Không có log DB `too many clients`. Diff test/repository Gmail này với main rỗng. Không sửa test/mã Gmail ngoài phạm vi; giữ output `review-check.log` và `review-check-final.log`.
- `npm run test:browser:v3` trên bản rebase exit **0**, **105 pass/1 skip có chủ đích**, đủ 12 nhóm: default 83 pass/1 skip, auth02 2, auth04 6, clarification 2, partial_failure 2, sáu workflow dịch vụ 6, answer 4/4 ở 1440/375 sáng/tối. Không đổi assertion, timeout hoặc retries browser. Output `review-browser.log`.
- `npm run check` lượt cuối sau khi browser dừng, cùng source: exit **0**, **1.953 v3** (63 schema + 408 adapter + 291 planner + 42 executor + 464 API + 685 web) **+ 173 eval**. Typecheck/build/security scan/launcher 1/1/env-OIDC 10/10 đều đạt. Output `review-check-after-browser.log`. Build vẫn 880,59 kB main JS / 216,89 kB gzip, cảnh báo chunk >500 kB có sẵn.
- Output P1/P8 ở `.cache/ans-01/review-mutation-*.log`, planner ở `review-planner-rebased.log`, các gate ở `review-check*.log`/`review-browser*.log`; đều ignored.

## Bàn giao

- Không dùng model/9router, không nghiệm thu Google thật hoặc thực thi workflow ghi dịch vụ thật. Ghi chú của reviewer về answer chỉ dựa vào prefetch (lookups rỗng) giữ theo đặc tả 5.3, để GMAIL-04 đo riêng; không mở rộng validation trong PR này.
- Cập nhật chính PR #142 sau khi gate đạt bằng `--force-with-lease` khoá đúng remote cũ ở trên, chỉ nhánh PR này. Nếu remote đã đổi thì lease từ chối; không ghi đè thay đổi của người khác, không push main.
- Chờ reviewer kiểm lại P2/P3 và bản tích hợp; chưa merge hoặc tự chứng nhận review độc lập đạt.
