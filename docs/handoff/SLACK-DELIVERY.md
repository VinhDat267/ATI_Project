# Slack delivery · trạng thái và cổng nghiệm thu

Verified 01/11/2026 on `integration/slack-personal-20261029` through PR #219 (`eabb4455`). Canonical current cross-task matrix; spec/cards retain requirements and logs retain historical evidence. Staging is not main; content/automation flags remain off.

## Cách đọc trạng thái

- **Mã:** implementation và kiểm thử thành phần đã review; `staging` yêu cầu CI xanh đúng head và cây merge được đối chiếu. Có code không đồng nghĩa luồng người dùng đã dùng được.
- **Tích hợp:** luồng xuyên module chạy bằng entrypoint thật, PostgreSQL thật và HTTP fixture; phải ghi rõ input, đầu ra và phạm vi. Factory test riêng không thay cho bootstrap test.
- **Native:** Slack thật Free/Pro, hai user, quyền thực tế, readback và model theo07. HTTP fixture không đáp ứng cột này.
- **FullF3/F4:** chỉ đóng khi mọi yêu cầu tương ứng đủ bằng chứng; không lấy số PR/test hoặc8/253 methods làm phần trăm hoàn thành.

## Requirement → card → head → evidence

| Yêu cầu / card sở hữu | Mã đã chấp nhận | Tích hợp đã chứng minh / còn thiếu | Native |
|---|---|---|---|
| F1/F2 OAuth, consent, multi-workspace · SLACK-02 | Backend/UI đã tích hợp tại `630eade5` / `ce9380e9`; [review](log/2026-10-29-slack-02-joint-review.md) | Contract/binding/metadata cho các slice bên dưới; không suy toàn bộ trợ lý đã xong từ OAuth | Chờ07 |
| Contracts · [03A](tasks/SLACK-03A-source-contracts.md) | #194 `bc8d6b69`, integration `57069aee` | Được các source/read/lifecycle slice sử dụng | Chờ07 |
|8 private reads · [03C1](tasks/SLACK-03C1-core-read-adapters.md) | #199 `390b1c54`, [CI/review](log/2026-10-30-slack-03c1-review-integration.md) | HTTP fixture/typed adapter; chưa nối public planner/executor | Chờ07 |
| Raw store/barrier · [03B1](tasks/SLACK-03B1-source-store-and-invalidation.md) | #200 `23544be9`, [CI/review](log/2026-10-30-slack-03b1-review-integration.md) | PostgreSQL isolation, invalidation/raw erasure; derived có cổng riêng | Chờ07 |
| Private read wrapper · [03B4A](tasks/SLACK-03B4A-private-read-wrapper.md) | #203 `3a9fa3e4`, [review](log/2026-10-30-slack-03b2a-03b4a-joint-review.md) | Nội bộ; chưa public routing/planner/executor/UI | Chờ07 |
| Derived registry · [03B2A](tasks/SLACK-03B2A-derived-registry.md) | #204 `e2aa4f8c`, [review](log/2026-10-30-slack-03b2a-03b4a-joint-review.md) | `messages.content` có registration/read guard; không chứng nhận writer khác/backfill | Chờ07 |
| Message handler/consumer · [03B2B](tasks/SLACK-03B2B-message-content-purge.md), [03B2C](tasks/SLACK-03B2C-message-purge-consumer.md) | #206 `3ea9fbd9`, #208 `145a6016`; [integration](log/2026-10-30-slack-03b2c-review-integration.md) | Native sandbox bootstrap xóa registered message khi cờ tắt/không Slack config; sáu kind khác vẫn pending | Chờ07 |
| Derived policy fanout · [03B2D](tasks/SLACK-03B2D-derived-policy-fanout.md) | #209 `5bdfbd68`, [CI/review/integration](log/2026-10-30-slack-03b2d-review-integration.md) | Native sweep stages derived obligations dù raw đã hết retention; không coi stage obligations là physical erasure | Chờ07 |
| Signed ingress · [04A](tasks/SLACK-04A-signed-ingress.md) | #202 `6d0e82af`, integration `3770f261` | Raw signature→durable receipt/queue; không có content/authorization fanout đầy đủ | Chờ07 |
| Validation/runtime · [04B1](tasks/SLACK-04B1-lifecycle-validation.md), [04B2](tasks/SLACK-04B2-validation-runtime.md) | #205 `3e19386e`, #207 `76f55a3c`; [integration](log/2026-10-30-slack-04b2-review-integration.md) | Metadata auth.test supervisor khi cờ tắt. Credential có refresh token gặp invalid_auth giữ gate đóng; recovery còn mở | Chờ07 |
| Committed bootstrap chain · [DELIVERY-01](tasks/SLACK-DELIVERY-01-workflow-repair.md) | #210 `fc6a00f9`, [CI/review/integration](log/2026-10-30-slack-delivery-review-integration.md) | Signed revoke→validation→disconnect→message purge; owner khác giữ nguyên. Probe không Slack config. [Test](../../apps/chat-api/tests/integration/slack-native-runtime.test.ts) chạy trong CI | Không thay07 |
| Message/memory lifecycle · [03B2E](tasks/SLACK-03B2E-message-memory-runtime.md) | #211 `72eb477d`, integration `acec5ca7`; [CI/review](log/2026-10-31-slack-03b2e-review-integration.md) | Transactional real writer, metadata/array/singular memory selectors, guarded HTTP/history/planner and native fixture purge with flags/config absent. Plan/schedule lifecycle accepted03B2F/G; full legacy cutover/backfill still open; derived TTL accepted03B2H | Chờ07 |
| Plan/execution lifecycle - [03B2F](tasks/SLACK-03B2F-plan-execution-runtime.md) | #212 `2395eeb7`, integration `83519243`; [CI/review](log/2026-10-31-slack-03b2f-review-integration.md) | Actual chat/plan/step/audit transactional provenance, guarded preview/approval/recovery/HTTP dispatch and native fixture physical erasure. Schedule lifecycle accepted03B2G; public Slack dispatch gated | Pending07 |
| Schedule lifecycle - [03B2G](tasks/SLACK-03B2G-schedule-runtime.md) | #213 `e6af7128`, integration `3a8ae645`; [CI/review](log/2026-10-31-slack-03b2g-review-integration.md) | Actual source proposal/confirm/state/run/title/plan registration, guarded HTTP/history/model/approval/dispatch and native fixture erasure with flags/config absent. Both Slack namespaces gated on source-bound dispatch; human rename/successor and owner capacity races covered | Pending07 |
| Independent derived expiry - [03B2H](tasks/SLACK-03B2H-derived-expiry-runtime.md) | #214 `a30625fe`, integration `d8c9119f`; [CI/review](log/2026-10-31-slack-03b2h-review-integration.md) | Exact immutable expiry proof/receipt -> fenced five-core-kind consumers -> native fixture physical erasure after raw is gone, flags/config absent. Fresh equal-reference capture/other owner survive; future06 intents pending | Pending07 |
| Message/memory/title origin - [03B2I](tasks/SLACK-03B2I-message-origin-cutover.md) | #215 `77c0c563`, integration `7d00de3f`; [CI/review](log/2026-10-31-slack-03b2i-review-integration.md) | Actual writers seal an owner-bound source-free remainder; HTTP/history/search/model reject unknown legacy and raw-SQL bypass. Bounded backfill defaults to dry run and was not applied to production data. Schedule origin was later accepted as 03B2K | Pending07 |
| Plan/step/audit origin - [03B2J](tasks/SLACK-03B2J-plan-origin-cutover.md) | #217 `1344feca`, integration `471c8a83`; [CI/review](log/2026-10-31-slack-03b2j-review-integration.md) | Source-free plan and step writers seal a private remainder. Approval, snapshot and dispatch reject unmarked or mutated plans. Slack-sourced plans keep 03B2F lineage. Schedule rows are not certified | Pending07 |
| Schedule origin - [03B2K](tasks/SLACK-03B2K-schedule-origin-cutover.md) | #219 `f22fa4ba`, integration `eabb4455`; [CI/review](log/2026-11-01-slack-03b2k-review-integration.md) | Source-free schedule writers seal name, request, recurrence, services and user id. Tick and planOne reject an unmarked or mutated row. Backfill does not certify unclear legacy. Slack-sourced schedules keep 03B2G lineage | Pending07 |
| Migration/expiry source gates - [03B2](tasks/SLACK-03B2-derived-lineage-and-purge.md) | 03B2K accepted. Open: public read 03B3, then 03B4 | Required before a public Slack read through the app. Unknown legacy is not certified merely because it has no copy. The 03B3 plan anchored at `612ac427` is not the implementation baseline | Pending07 |
| Binding/approval/dispatch · [03B3](tasks/SLACK-03B3-executor-binding-and-approval.md),03B4 phần còn lại | PLAN_ONLY / chưa public integration | Read integration trước; write dispatch bị chặn tới04C | Chờ07 |
| FullF4 · [04](tasks/SLACK-04-ingress-lifecycle-and-execution-safety.md) | Mở: authorization fanout/app token, sáu watermark, rotation recovery,04C outbox/echo/UNKNOWN | Không đóng bằng ingress và auth.test riêng lẻ | Chờ07 |
| FullF3, ba mode theo user/workspace, Inbox/digest ·03B2+05+06 | Mở | Năm nhóm artifact hiện hữu là mốc core; `proposal_excerpt`/`daily_digest_entry` chỉ nghiệm thu khi06 có artifact/writer/reader thật | Chờ07 |
| Toàn bộ API phù hợp Free/Pro ·03D/03E+07 | Mở |354 snapshot rows:101 excluded,253 probe_required.8 adapter đọc: conversations.list/info/history/replies/members, users.list/info, chat.getPermalink. Chưa native eligible/accepted | Chờ07 |

## Thứ tự bàn giao từ đây

| Mốc | Deliverable kiểm chứng được | Điều kiện chốt |
|---|---|---|
| M1 · ĐÃ ĐẠT (nội bộ/fixture) |03B2D và DELIVERY-01 đã accepted: ký sự kiện→durable job→metadata validation→registered message erasure, cờ tắt, cách ly owner | Review độc lập đạt, committed bootstrap regressions và exact-head CI/check/browser xanh. Không đóng03/04 hay fullF3/F4 |
| M2 - source safety and manual reads in ATI | 03B2E/F/G accepted five actual core kinds and their writer/read/run/erasure paths. 03B2H accepted derived TTL. 03B2I accepted message/memory/title origin. 03B2J accepted plan/step/audit origin. 03B2K accepted schedule origin. Still open: 03B3 (read) then 03B4 public route/planner/executor/UI | Approved read through real app; revoke/edit/delete/policy change blocks reuse and erases core artifacts; owner/workspace isolation. 05/06 required for full F3 |
| M3 · ghi an toàn dưới danh nghĩa user |04B authorization fanout/sáu watermark/rotation recovery;04C outbox+echo+UNKNOWN, rồi03C writes/03B3 write dispatch | Provider commit rồi timeout bằng AbortSignal không ghi lặp/retry mù; readback/reconciliation, approval và binding đúng.03C writes phụ thuộc04C, không đặt trước04 |
| M4 · trợ lý và full lifecycle |05 ba mode,06 Inbox/digest trong ATI; tích hợp hai kind mới vào03B2 | Thu hồi nguồn không còn excerpt ở bất kỳ surface nào; khi đủ bảy kind + mọi yêu cầu khác mới đánh giá fullF3/F4 |
| M5 · phạm vi đầy đủ và phát hành |03D/03E đối soát từng method;07 benchmark/live Free/Pro/hai user; release gate | Không mất scope đã duyệt. Native evidence từng method/luồng, model×3 theo spec, exact-head CI và duyệt trước main/bật cờ |

M2 và M3 có thể chuẩn bị thiết kế độc lập; thứ tự trên là thứ tự nghiệm thu, không phải hàng rào “xong mọi03 rồi mới04”. Ở mỗi thời điểm root chỉ thi công một card trên một branch. Việc kế tiếp là đọc công khai 03B3, rồi 03B4. Không dùng nguyên kế hoạch 03B3 neo ở `612ac427`. Không mở thêm primitive riêng nếu nó chỉ có ý nghĩa khi ghép cùng handler/writer/read gate.

## Cách thi công tránh làm lại

1. Bắt đầu từ accepted staging head; đọc card, bảng này và ba log mới nhất. Xác nhận worktree/HEAD/dirty, giữ nguyên thay đổi của người khác.
2. Chọn deliverable có input→output thực. Một PR có thể ghép schema/handler/wiring cần thiết cho cùng deliverable; không dùng quota/tiện chia file làm ranh giới task. Ghi rõ owner/interface khi qua package.
3. TDD bằng PostgreSQL/HTTP/AbortSignal thật; chạy focused suite khi sửa. Ghi base/head, lệnh, exit code và giới hạn trong log. Kiểm tra lỗi cạnh tranh đúng chỗ bằng lock/SQL thật.
4. Freeze product/base, chạy một fullcheck rồi review độc lập toàn branch. Chỉ chạy lại fullcheck khi source/base thay đổi, có failure hoặc concern chưa giải quyết. Nếu staging thay đổi trong lúc CI, gộp và kiểm chứng cây kết hợp trước merge.
5. Exact-head CI gồm check/browser phải xanh. Reviewer tích hợp staging, đối chiếu merge tree, cập nhật dòng tương ứng trong bảng và CURRENT/ROADMAP sau merge. Tick publication của card con lúc đó; log cũ không phải status hiện tại.
6. Khi chỉ xong mã hoặc một phần tích hợp, ghi đúng mức ấy. Chưa có live credentials/owner acceptance thì để native mở; không tự bật cờ. Không cần xin lại quyền cho các bước reversible đã được giao.
