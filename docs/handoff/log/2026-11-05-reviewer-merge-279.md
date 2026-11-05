# Reviewer & Merge — PR #279 · callback Gmail/Jira, FLOW-07 còn mở

- **Ngày merge:** 05/11/2026, 16:29:21 +07 (`2026-11-05T09:29:21Z`), theo yêu cầu merge rõ ràng của chủ dự án.
- **PR:** [#279](https://github.com/VinhDat267/ATI_Project/pull/279), nhánh nguồn `test/flow07-app-acceptance`.
- **Base:** `63f91f9ea0befce61e1b78a69bd8df228a6fa6c5`; source fix `6268e482891143b530b8e4d3500b53bd77a389ea`.
- **Head review/CI cuối:** `0865577375348bf3c67fe8d25f0e9a833d71e109`; các commit sau source fix chỉ đổi tài liệu/bằng chứng.
- **Merge commit:** `caa6cc5652dcb651a72061329efa1f54bdf80886`; **tree:** `ce0e11f1737180d654557c1c205f613b729bec27`, trùng head review/CI (`git diff 08655773 caa6cc56` exit 0).
- **CI:** [#41998582230](https://github.com/VinhDat267/ATI_Project/actions/runs/41998582230) **SUCCESS đúng head `08655773`**, gồm full check/browser; trạng thái do agent thực thi/merge kiểm tra và bàn giao.

## Phạm vi và review độc lập

1. Router nhận cả `/connections/jira/callback` và `/connections/myjira/callback`, dùng chung parser/handler một lần.
2. Khi callback về loopback host giữ session cũ hết hạn, AuthGate dùng input OAuth còn trong route sau scrub URL để thử host loopback còn lại trước khi về login. Không chuyển token giữa host; giữ chặn domain ngoài loopback, callback hủy, logout chủ động/cross-tab.
3. Review độc lập source `63f91f9e..6268e482` không còn phát hiện P1/P2 cụ thể trong phạm vi. Reviewer chạy lại 7 file callback/auth/session/storage/return-target: **82/82 PASS**, web `tsc --noEmit` và `git diff --check` exit 0.
4. Review cuối xác nhận runtime/test sources của `246807ab` trùng `6268e482`; ba file thêm chỉ là tài liệu/bằng chứng, không chứa giá trị account/state/code/token/cookie. Đã sửa cách diễn đạt để phân biệt Gmail callback 401 với Jira phục hồi qua AuthGate, và gọi 400 là phản hồi API callback sau exchange bị từ chối. Head cuối `08655773` chỉ thay các tài liệu này.

## Kiểm tra toàn bộ và provenance

Agent thực thi bàn giao lệnh cuối `DATABASE_URL=<isolated test DB> VITEST_MAX_WORKERS=2 npm run check` **PASS, exit 0**:

- Schemas **579**, adapters **636**, planner **547**, executor **55** test PASS.
- Chat API **2.471**, chat web **1.187** test PASS.
- Evaluations **500 PASS / 1 preflight chủ động SKIP**.
- Build, web build security, launcher và Node checks PASS.

Reviewer không chạy lại full suite khi chỉ thêm tài liệu. Cây merge được đối chiếu trực tiếp với head review/CI. Sau merge, agent thực thi kiểm tra dev server hiện hành trả HTTP 200 cho `/src/routes.ts` và `/src/components/AuthGate.tsx`, đang phục vụ Jira alias và `tryRecoverLoopbackConnectionCallback`; đây chỉ là kiểm tra mã frontend được phục vụ, không phải browser/consent acceptance.

## Native callback: phạm vi bằng chứng

- Browser thật + API production composition (`runtimeMode=live`) + PostgreSQL thử xác nhận quay lại host khởi tạo, consume state theo session/browser binding gốc, một callback đã xác thực và session gốc còn HTTP 200.
- [Bản xuất đã bỏ dữ liệu tài khoản](../../ai-evidence/FLOW-07-OAUTH/2026-11-05/native-callback-probes.json) gắn source `6268e482`: Gmail ghi callback localhost 401 rồi callback host gốc 400; Jira phục hồi qua AuthGate, bản xuất chỉ có callback host gốc 400.
- Code cố ý không hợp lệ; API callback 400 sau exchange bị từ chối là mong đợi. **Không chứng nhận real consent/token exchange thành công**; hai probe callback không có workflow write.

## Kết quả native bổ sung sau log callback

Các kết quả sau do agent thực thi bàn giao từ phiên app/API/PostgreSQL/provider thật; bằng chứng riêng tiếp tục giữ tại `.audit/flow07-app/`, không đưa account ID, token, PII hoặc permalink vào handoff công khai.

- **OFF-03, một lượt dữ liệu rỗng:** đọc bảng rỗng thật → preview được xem/duyệt → đúng một lệnh Slack hoàn tất. Đọc độc lập nguồn và readback tin nhắn/nội dung/hash khớp. Chỉ chứng minh ca dữ liệu rỗng này; chưa chứng minh tổng hợp số hoặc OFF-03 3/3.
- **DEV-02:** bị từ chối trước preview; GitHub lookup trả `reconnect_required`. Không có preview/approval hoặc workflow write được chứng nhận từ lượt này; chưa kết luận nguyên nhân grant.
- **Chuẩn bị dữ liệu số OFF-03:** `create_sheet` thất bại `AUTH_ERROR`, `requestSent:false`; DB plan `partial`, bước append còn `pending`. Không retry, không coi bước pending là đã ghi; chưa kết luận nguyên nhân grant.

## Trạng thái sau merge và việc tiếp theo

- **FLOW-07 vẫn OPEN:** còn consent/exchange Gmail/Jira thật trên bản vá, đủ sáu workflow × ba lượt native có provider writes/readback và sáu persona qua app/history. Một lượt OFF-03 dữ liệu rỗng không thay thế cổng 18 lượt.
- **Đính chính số liệu lịch sử:** DeepSeek **18/18** trước đó là lượt planner với **LLM thật + `fixtureSearch` + evidence/context guards**; **36/36** là oracle regression. Đây không phải 18 lượt native thực thi đầy đủ trên provider, không đóng FLOW-07.
- `CURRENT-STATE.md` thêm merge #279 và giới hạn hiện hành; `ROADMAP.md` bỏ kết luận cả tám FLOW task đã xong, giữ FLOW-01..06/FLOW-08 ở mức mã đã hợp nhất và FLOW-07 OPEN.
- Phiên handoff này chỉ sửa hai tài liệu reviewer và thêm log mới; giữ `.audit/`, task card, runtime/test sources và mọi thay đổi ngoài phạm vi. Không commit/push/merge trong bước chuẩn bị tài liệu này.
