# 29/10/2026 · Re-review SLACK-01 / PR #183

**Verdict: CHƯA ĐẠT tại `181325b7d16787fa93b9a759a0cb1cb42ab8e675`.**
0 Critical, 3 Important (P2), 0 Minor. Không sửa product code, không push/merge hoặc đăng review lên GitHub trong lượt này.

## Scope và provenance

- Chủ dự án yêu cầu: “hãy review lại SLACK-01”.
- PR base/main `b437f985d479d3a9d413ddd3fb2361eceedf6d5e`; head `181325b7d16787fa93b9a759a0cb1cb42ab8e675`, draft/open.
- Foundation implementation sau `2bf87b747672f207937397f2ba9186fcb97373af`; diff trước đó là chuỗi thiết kế đã chấp thuận. Đọc task card, kế hoạch, thiết kế, handoff, actual diff và checklist.
- Reviewer context mới đọc code độc lập, không sửa checkout, tái hiện bằng HTTP thật. Agent điều phối chạy lại test/full check và tái hiện riêng cả ba finding.
- Worktree hiện có, tách checkout chính: không có .codegraph. Checkout chính có bảy thay đổi không thuộc task; worktree có bốn log PR180 untracked. Tất cả được giữ nguyên.

## F1 · P2 · Workspace isolation vẫn có false PASS

**Vị trí:** `scripts/slack/contract-probe.mjs:94`, kiểm chiều còn lại tại 120–122.

`sources:visibility` chỉ kiểm ba seed Free có mặt như một tập con. Không loại dữ liệu của workspace Pro khỏi Free history; `isolation:b` chỉ kiểm phía history Pro.

**Tái hiện:** HTTP relay forward fixture thật; ở trang cuối `conversations.history` token A/channel C_GENERAL, thêm Pro seed `U_PRO_A / 2000.000001 / Pro root`, giữ cursor hợp lệ. Hai response Free bị thêm nguồn ngoài workspace.

**Kết quả thực:** `unexpectedAllPass:true`, toàn bộ **11/11 check PASS**, gồm sources:visibility và isolation:b. Đây là lỗi của gate kiểm thử isolation; chưa phát hiện chính fixture lưu nguồn sai workspace.

**Đề nghị:** kiểm đủ tập nguồn hợp lệ cho từng workspace, gồm tác giả/ts/text, và từ chối nguồn ngoài workspace trước khi ghi. Thêm regression Pro→Free. Nếu helper phải chạy lại trên fixture đã có probe writes thì quy định riêng các write hợp lệ đó, không chấp nhận mọi nguồn bổ sung.

## F2 · P2 · Thread mất ba tin nguồn vẫn có false PASS

**Vị trí:** `scripts/slack/contract-probe.mjs:117–118`.

Readback chỉ tìm đúng một message khớp receipt. Vì không kiểm root/hai seed replies đã biết, không chứng minh thread được đọc đầy đủ theo contract pagination của Task5.

**Tái hiện:** cho write và receipt thật chạy bình thường. Relay `conversations.replies` chỉ trả message vừa ghi, bỏ root và hai seed replies, báo `has_more:false` và cursor rỗng.

**Kết quả thực:** `dropped:3`, `unexpectedAllPass:true`, toàn bộ **11/11 PASS**, readback:a vẫn pass. Bản sửa history của181 không phủ nhánh replies này.

**Đề nghị:** kiểm đủ root + hai seed + đúng một write theo receipt; thêm regression missing-thread-sources với terminal metadata giả.

## F3 · P2 · XML sitemap hỏng làm mất method nhưng collection/verify vẫn đạt

**Vị trí:** `scripts/slack/inventory.mjs:23–29`.

Parser chỉ tìm wrapper urlset và những cặp loc đóng đủ, không từ chối XML không hợp lệ. Phần loc hỏng bị bỏ qua, rồi index thu nhỏ trở thành frozen index mới.

**Tái hiện qua HTTP loopback thật:** fetchImpl chỉ ánh xạ URL docs chính thức sang server fixture. Thu inventory hợp lệ có hai method auth.test/chat.postMessage, đánh reviewed. Lần sau trả:

```xml
<urlset><url><loc>https://docs.slack.dev/reference/methods/auth.test</loc></url><url><loc>https://docs.slack.dev/reference/methods/chat.postMessage</urlset>
```

Đây là XML không well-formed, không phải một sitemap hợp lệ chủ động xóa method.

**Kết quả thực (5 HTTP requests cho hai lượt collect):**

```json
{"before":["auth.test","chat.postMessage"],"after":["auth.test"],"reviewStates":["reviewed"],"errors":[],"unexpectedAccepted":true}
```

`collectInventory({previous})` thành công, và `validateInventory(after)` trả mảng rỗng. Snapshot343 row đang commit không bị sửa và vẫn khớp cached evidence; lỗi nằm ở cách collector tiếp nhận nguồn hỏng.

**Đề nghị:** từ chối XML không hợp lệ trước extraction/index construction; regression chứng minh collection thất bại và file snapshot trước đó được giữ nguyên.

## Kiểm tra mới trong lượt review

| Check | Outcome |
|---|---|
| `npm run test:slack:foundation` | 39 Node +49 schema =88 PASS, exit0 |
| Hai regression history của181 | Reviewer mới chạy riêng2/2 PASS; full foundation cũng chạy chúng |
| `npm run check` | 2,558 workspace +406 eval fixture +1 launcher +49 Node batch PASS; typecheck/build/build-security PASS, native exit0 |
| PostgreSQL | PG16 thật, Compose project riêng ati-slack01-review-183, port55533 trống trước tạo; migrations0001–0013 applied |
| Cached method facts | Cả343 source hashes và method/URL/HTTP/rate/userScopes/userToken khớp snapshot |
| Inventory CLI mutations | omitted/duplicate/unreviewed/source_changed: cả4 exit1; dùng bản sao, snapshot gốc bytes unchanged |
| Snapshot SHA256 | e5dd6fc6366c08c10c3ed238ab00e319e7e89901bea586702ccfddc40f4d27d5 |
| Handoff raw-log provenance | Hash F6BE6C9D1DF6F3F4259B41D21FC0CBFF064B2272956D85C4F3DD4F1771C59ED6 khớp raw full-check log trước review |
| Fresh full-check log SHA256 | 149B1D73EAD903E87B405AA213363B661AA20773CD22474E8BBED2282E569757 |
| Exact-head CI | [40733542757](https://github.com/VinhDat267/ATI_Project/actions/runs/40733542757), SUCCESS; headSha đúng181325b7; gồm browser suite |
| Runtime scope | Actual diff không sửa apps, adapters, executor, planner, db, prompts/evaluations hoặc catalog/registry; index chỉ thêm2 exports |
| Whitespace/code changes | git diff --check exit0; không sửa source/test/HEAD |

Artifacts giữ tại `.superpowers/review-slack01-183/`: foundation.log, full-check.log, migration.log, reproductions.mjs/log và xml-reproduction.mjs/log. Script reproduction cố ý assert false acceptance còn hiện diện trên head đang review; output exit0 của script là tái hiện finding thành công, không phải acceptance pass.

## Scope set aside, không suy ra đã nghiệm thu

- Enforcement consent/provider thật trong API/planner/manual/rule/scheduler: SLACK-02–06, hiện chỉ pure contract. Phải có integration gate trước khi consumer được bật.
- OAuth/callback CAS/rotation/refresh/disconnect PostgreSQL: SLACK-02; fixture không mô phỏng OAuth.
- Source ACL/tombstone/purge/history/memory/race thu hồi: SLACK-03–04; branch không ingest nguồn Slack thật.
- Signed ingress/authorization fanout/echo/outbox/lifecycle khi pause: SLACK-04; chưa có ingress ở đây.
- Ba mode/budget/backlog/Inbox/UI: SLACK-05–06; browser local NOT_RUN vì không đổi UI, browser CI xanh được kiểm riêng.
- Native Free/Pro/role/quota và các row probe_required, model evaluation, live readback/bật cờ: SLACK-07, NOT_RUN. Eval406 là fixture tests.
- Không tải lại343 trang docs để tuyên bố metadata hiện hành; chỉ kiểm toàn bộ cached source SHA/facts tại thời điểm snapshot.
- Full check và exact-head CI được agent điều phối kiểm mới, không dựa thay vào claim của reviewer con hoặc implementer.

## Kết luận

History thiếu cursor/seed ở finding cũ đã được sửa hiệu quả. Ba lỗ hổng acceptance ở trên vẫn có tái hiện deterministic qua HTTP thật; CI và test xanh chưa phân biệt được chúng. Cần sửa và thêm regression trước khi chốt SLACK-01. Chưa merge và chưa bật Slack live.
