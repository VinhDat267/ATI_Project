# MVP v2 — Offline gate cho AI source-aware trong API pilot

**Trạng thái: PROPOSED — chờ duyệt bản viết.** Ngày lập: 27/09/2026.
Thiết kế này không cấp quyền gọi provider thật, không mở Trello write và không
nâng nhãn AI quality/customer acceptance. Chủ project đã đồng ý theo từng phần
trong hội thoại với hướng tái dùng ledger, chỉ lưu outcome an toàn và giữ hold
khi chi phí không rõ; cần duyệt **bản spec này** trước khi lập implementation
plan. Căn cứ phạm vi: [baseline](../../BASELINE.md),
[execution contract](../../EXECUTION-CONTRACT.md),
[API README](../../../apps/api/README.md).

## 1. Ý định, hiện trạng và phạm vi batch

Mục tiêu: kiểm chứng bằng fake provider trên PostgreSQL/HTTP cô lập rằng AI
source-aware của `/pilot/v2` chỉ nhận đúng snapshot đã lưu, được phép theo
principal, có trần số call và ngân sách riêng, và không thể tự cấp approval hay
write. Hai principal có campaign và outcome riêng. Các test này là bằng chứng
**offline contract**, không phải chất lượng model, billing thật, SaaS live hay
nghiệm thu người dùng. Giữ một active run toàn DB, owner approval, policy
allowlist, preview/hash/version/TTL 10 phút và no blind retry cho remote write.

Hiện router có `pilotPlanner` opt-in; `main.ts` không cài nó. Router lưu run và
source snapshot trước callback, kiểm lại policy/snapshot trước approval. B/local
có `ai_provider_campaigns`, `ai_provider_calls`, `PostgresProviderCallLedger`;
`createApiAuthorizeCall` của B/local yêu cầu worker lease nên không dùng cho
pilot HTTP. `packages/engine/src/pilot/accounting.ts` hiện ghi các cột không
có trong migration `0008`; không dùng các helper đó để cấp quyền/ghi call.
`GET /pilot/v2/runs/:id` đã có trường optional `clarificationQuestion` và
`refusalReason`, nhưng router chưa lưu/chiếu outcome tương ứng.

Batch này thêm gate offline, lưu/hiển thị outcome an toàn và test fake. Không
cài Gemini/OpenAI vào pilot production; không gọi provider thật, không phát
sinh phí, không tạo Trello card mới, không tạo endpoint tự cấp grant hoặc tự
giải hold. Kết nối provider thật, khóa price card/rubric/benchmark v2 và xin
quyền quota là batch riêng sau khi gate offline đạt.

## 2. Các phương án và quyết định

| Cách | Lợi ích | Giới hạn |
| --- | --- | --- |
| **Grant DB + campaign pilot per principal** (chọn) | Thu hồi và đếm call bền vững; tái dùng reserve/settle và trần tiền đã có | Cần migration và admission transaction dùng chung ledger |
| Cấu hình môi trường + ledger | Ít schema | Thu hồi/giới hạn số call không đủ bền vững khi cạnh tranh/restart |
| Callback in-memory thuần | Test nhanh | Không tạo ranh giới quyền/provider có thể kiểm chứng |

Grant là quyền operator cấp phía server, **không** suy từ bearer session,
`AI_PROVIDER_CALLS_ENABLED` của B/local, sự tồn tại API key, hoặc pilot source
policy. Grant và policy source/board đều phải hợp lệ. Không có fallback sang
campaign/model/provider B/local nếu thiếu grant hay accounting lỗi.

## 3. Dữ liệu và ranh giới module

Một migration additive tạo:

- `pilot_ai_grants`: `campaign_id` duy nhất, `principal_id` duy nhất (một
  grant pilot cho mỗi principal trong bản cài pilot này; chưa có rotation),
  provider/model cố định, `max_calls` nguyên dương,
  `max_estimated_cost_micros` nguyên dương (micro-USD/call), `expires_at`,
  `revoked_at`, timestamps;
  FK `(campaign_id, principal_id)` sang `(campaign_id, user_id)` của
  `ai_provider_campaigns`. Chỉ grant cho campaign prefix pilot và owner khớp;
  chiến dịch được operator cấp trần tiền dương, không bootstrap từ request.
  Estimate không vượt `max_estimated_cost_micros`, và tổng held+committed
  không vượt `ai_provider_campaigns.limit_micros`; adapter tin cậy tính
  estimate, không tin model/client và không dùng fallback rate trong
  `pilot/accounting.ts`. Offline fixture dùng giá giả cố định có nhãn
  simulated, không chứng minh giá thật. Không tự tạo grant trong launcher.
- `pilot_ai_attempts`: `run_id` primary key (một attempt/call mỗi run),
  `principal_id`, `campaign_id`, `call_id` unique/FK khi đã reserve,
  `state` (`reserved`, `dispatch_claimed`, `settled`, `uncertain`),
  `dispatch_claimed_at`, timestamps. Dòng có owner và FK run/campaign;
  truy vấn/mutation luôn đối chiếu `runs.user_id` và grant owner. Không có
  đường reset/đổi `run_id` để retry sau claim. Phase dùng để phân biệt khả
  năng đã gửi request, không khẳng định nhà cung cấp đã nhận request.
- `pilot_planner_outcomes`: `run_id` primary key, `principal_id`, `kind`
  (`plan`, `clarification`, `refusal`, `failure`), mã lý do allowlisted và
  message đã server tạo (tối đa 500 ký tự), timestamps. Chỉ ghi một kết quả
  terminal của planning; không lưu raw model output, prompt, source row hay
  exception. Snapshot nguồn đang tồn tại trong `source_snapshots` theo hợp
  đồng riêng; bảng outcome không nhân bản nó.

Admission coordinator nằm ở API (một module nhỏ, không nhét logic ngân sách
vào router), dựa vào DB, grant, policy và ledger. Server adapter tin cậy cung
cấp provider/model, estimate trước reserve và usage/cost evidence sau call;
model chỉ cung cấp proposal, không được khai chi phí. Fake adapter trong test
trả số liệu mô phỏng cố định; interface callback hiện trả `unknown` cần nâng
thành envelope tách proposal khỏi metadata của adapter, không giả định output
model hiện tại là bằng chứng thanh toán. Adapter chỉ nhận context đã đóng gói
cùng signal, không nhận DB handle, quyền approval hoặc write args. Ledger
vẫn là nguồn sự thật cho `held_micros`/`committed_micros`.
Tách transaction-scoped reserve khỏi `PostgresProviderCallLedger.reserve()` và
cho cả đường B/local cũ tiếp tục dùng wrapper transaction hiện tại; **không**
lồng transaction độc lập giữa admission và reserve. Settlement vẫn xử lý
idempotency/overrun theo ledger, kể cả grant bị thu hồi sau dispatch.

## 4. Vòng đời admission và dispatch

1. Nếu không inject planner, giữ nguyên đường checklist/policy hiện tại;
   **không** đòi grant. Checklist refusal/needs_input giữ ưu tiên và không
   cần grant/gọi AI. Với checklist pass và planner opt-in, kiểm sơ bộ grant
   sau intake nhưng trước tạo run để từ chối thiếu quyền mà không gọi
   callback; không xem precheck là bảo đảm vì quyền có thể bị thu hồi sau đó.
   Giữ single-active-run guard.
2. Commit run + workflow metadata + source snapshot trước planner callback.
   Context xây từ snapshot đã lưu và các secret cấu hình được che như hiện
   tại. `POST` vẫn theo contract `202` khi nhận run; trạng thái terminal đọc
   bằng owner-only `GET`. Nếu lỗi admission trước khi tạo run, trả lỗi an toàn
   mà không tạo run; nếu sau commit, đánh dấu run `failed` và không approval.
3. Transaction admission sau snapshot: khóa tài nguyên theo thứ tự nhất quán,
   kiểm owner/status `planning`, snapshot/version/checklist/policy, grant chưa
   hết hạn/chưa revoke, provider/model cố định, số call đã dùng, campaign chưa
   halt và tiền còn đủ; tạo duy nhất attempt và reserve ledger **cùng
   transaction**. Budget check và tăng hold phải atomic với grant/call-count
   check; concurrent run/client/restart không thể vượt trần. Một attempt đã
   tồn tại không được gọi lại model. Không gọi callback nếu reserve thất bại.
4. Ngay trước dispatch, một transaction khóa/kiểm lại run, grant và policy,
   ghi CAS `reserved → dispatch_claimed`; chỉ người thắng mới được gọi callback.
   Claim đã commit là ranh giới quyền dispatch: revocation được ghi trước
   claim chặn dispatch, nhưng revocation ngay sau claim vẫn có thể xảy ra
   trước khi gửi packet. Không giữ DB lock trong network call; sau claim,
   abort signal là best effort, không thể bảo đảm hủy call/chi phí. Thu hồi
   quyền sau claim chặn approval/kết quả hiển thị, không miễn settle. Không
   có worker tự resume claim.
5. Adapter trả proposal theo schema đóng `plan | clarification | refusal`
   cùng usage/cost evidence do adapter tạo; chỉ proposal được parse như output
   model. Trước khi commit outcome, transaction kiểm lại run/source/version/
   checklist, grant/owner/policy; nếu revoke hoặc drift thì không tạo approval. `plan`
   chỉ cho `trello.create_card`; router tự xác định board/list/action args,
   preview/hash và approval TTL 10 phút. Model không được chọn target,
   snapshot hash, approval hay dispatch. `clarification/refusal` kết thúc run
   không approval. Mỗi nhánh settlement/terminal status chỉ commit nếu state
   hợp lệ; không để kết quả trễ sau sweep đổi `failed` thành approved.

Reservation không nhất thiết nằm trong transaction tạo run vì hợp đồng đòi
snapshot commit **trước** callback. Điều kiện bắt buộc là các kiểm tra quyền,
call count, budget và **reservation** của chính call cùng một transaction;
không có khoảng trống giữa kiểm tra và giữ tiền. Trước transport có transaction
claim thứ hai để bắt revocation xảy ra sau admission.

## 5. Lỗi, chi phí không rõ và thu hồi quyền

- Không có claim/đã chứng minh không gọi transport: settle `failed/cancelled`
  với chi phí biết chắc bằng 0, giải hold theo ledger; `failed` không approval.
  Nếu thiếu bằng chứng chắc chắn, không tự suy ra cost 0.
- Đã claim rồi timeout, crash, response mất hoặc outcome không chắc chắn:
  đánh dấu `uncertain`, settle `ambiguous`/cost `null` nếu có thể; ledger giữ
  nguyên hold. Nếu process chết trước settle, `reserved`/`dispatch_claimed`
  cũng được xem là unresolved, không chạy lại. Sweep planning hiện chỉ diễn
  ra khi request pilot mới tới, không là daemon; nó có thể đóng run `failed`
  nhưng không xóa attempt/hold. Một lần thử mới không tái dùng claim cũ.
- Cost thực tế/usage hợp lệ được ghi dù grant bị revoke hay kết quả proposal
  bị từ chối; nếu cost vượt cap, ledger halt campaign và không cấp approval từ
  call đó. Lỗi settlement giữ failure/hold cần đối chiếu, không giả báo success.
- Operator chỉ **đối chiếu read-only**: kiểm call ID, log đã scrub,
  billing/receipt được phép truy cập và trạng thái ledger, ghi bằng chứng
  ngoài app theo runbook. Batch offline **không có thao tác giải hold**:
  `ambiguous` đã settle không thể gọi lại `settle()` với kết quả khác (ledger
  sẽ halt campaign). Hold chưa giải tiếp tục chặn ngân sách; không tự release
  theo tuổi hoặc vì không tìm thấy hóa đơn. Trước provider thật cần thiết kế
  và xin duyệt một đường operator-only có actor/evidence/audit, guard trạng
  thái và khóa call+campaign, chống lặp/lệch và settlement trễ, không tự gỡ
  halt; batch này không hứa tự phục hồi hay hủy được request đã gửi.
- Error HTTP/event/log chỉ dùng mã lỗi và thông điệp cố định, không serialise
  provider exception, raw prompt, body response, secret hay source value.
  Lỗi/timeout không tạo approval, không tạo remote write.

## 6. Outcome projection và kiểm chứng

Model được quyền đề nghị `clarification/refusal` với text giới hạn ở đầu vào
schema, nhưng text đó **không lưu/không trả ra** trong batch này. Server ánh
xạ `kind` và mã kết quả allowlisted sang thông điệp hữu hạn trung tính (ví dụ
"Cần xác nhận thêm thông tin yêu cầu trước khi tiếp tục" / "Không thể lập kế
hoạch từ yêu cầu này"). Không suy mã lỗi từ câu chữ tự do; `failure` cũng
chỉ dùng mã ổn định. Điều này hy sinh câu hỏi tùy biến để không dựa vào bộ
lọc không thể chứng minh khử mọi secret/PII. Nếu muốn lời hỏi lại chi tiết từ
model, phải có thiết kế redaction/UX/retention được duyệt riêng. `GET` owner-only
chiếu `clarificationQuestion` hoặc `refusalReason` theo status; trường kia
`null`, failure chỉ có mã/thông điệp an toàn. Không lộ outcome của principal
khác và không lẫn dữ liệu vào workflow plan, events, error hay request log.

Kiểm chứng theo TDD trong implementation plan: migration từ schema thật; unit
cho admission/status/projection; PostgreSQL+HTTP test với fake callback cho
hai principal, campaign tách biệt, thiếu/hết hạn/revoke grant, budget/call
limit, tranh chấp admission, claim trùng, timeout, crash trước và sau reserve/
claim/settlement, late response, policy/source drift, cross-owner GET/approve,
secret trong output, hold không tự thả, operator đối chiếu read-only không
đổi ledger, không external provider fetch/remote write. Các test cũ inject
planner phải được chuyển sang cấp grant fixture có kiểm soát; không tạo bypass mặc định cho test. Chạy targeted tests, `npm run
check`, integration DB cô lập, `git diff --check` và Code Reviewer độc lập
sau implementation. Kết quả fake chỉ ghi `OFFLINE_TESTED`; live provider
quality và customer acceptance vẫn `NOT_RUN`.

## 7. Điều kiện tách batch sau

Không nối provider vào `main.ts` chỉ vì gate offline qua. Trước provider thật
cần quyền operator riêng về provider/model, quota/call cap, bảng giá/bound có
nguồn, chiến dịch ngân sách theo principal, rubric/holdout không đọc oracle,
transport có kiểm claim/settle, đường operator-only giải hold có audit được
phê duyệt riêng và kiểm billing/cancellation thực tế. Trước Trello write mới vẫn cần owner approval, allowlist, preview TTL và kế hoạch
reconciliation được cấp quyền riêng. Bất kỳ lời hứa AI quality, kết quả SaaS
hay handoff nào đều cần bằng chứng riêng.
