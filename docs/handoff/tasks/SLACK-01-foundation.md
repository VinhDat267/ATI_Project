# SLACK-01 · Contract nền, kiểm kê API và HTTP fixture

**Trạng thái:** xong phần nền, đã merge #183 vào main tại `3d0edfa0` ngày 29/10/2026; review độc lập đạt và CI xanh đúng head `ce08da98`. OAuth/live và phần trợ lý Slack đầy đủ ở SLACK-02–07 vẫn mở.
**Nhánh mã:** `feat/slack-01-foundation` · **Nền:** `2bf87b74`.
**Phụ thuộc:** thiết kế OAUTH-04 bản sửa `d479b098` đã được chủ dự án cho chuyển sang triển khai.
**Thiết kế:** [Slack cá nhân](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).
**Kế hoạch:** [Slack Personal Foundation](../../superpowers/plans/2026-10-28-slack-foundation.md), đọc hết cùng thiết kế trước khi làm.

## Mục tiêu và phạm vi

Thêm hợp đồng identity/source/policy, inventory từng phương thức có nguồn, fixture HTTP có state/phân quyền và probe offline chống nhầm bằng chứng live. Năm task nhỏ trong plan đều thuộc deliverable này. Schema thống nhất trước script/consumer; root package cần owner review.

Không route/API/UI Slack cá nhân, DB/OAuth/refresh thật, model, app install hay bật cờ trong card này. Các card 02–07 trong lộ trình của kế hoạch vẫn mở; không dùng card 01 để tuyên bố full Slack.

## Tiêu chí nghiệm thu

- [x] Binding/source contract giữ đủ actor/workspace/generation; invalid/mismatch bị chặn.
- [x] Policy dùng nguồn/model kiểm chấp thuận, provider và retention; không suy quyền từ OAuth. Đây là helper thuần, chưa gate các consumer ở 02–06.
- [x] Inventory đủ row so với snapshot index, có provenance/requirements/disposition; chưa chứng minh thì ghi probe_required và reason.
- [x] Fixture thật HTTP chứng minh scope, workspace/user, cursor và AbortSignal; timeout sau ghi không bị hiểu là chưa ghi.
- [x] Probe chỉ loopback, từ chối redirect/live, không retry write UNKNOWN và không log token/body; report ghi verifiedLive false.
- [x] RED→GREEN, test:slack:foundation/typecheck/check đạt; catalog và service cũ không thêm myslack.
- [x] Reviewer độc lập, CI đúng head, log bàn giao và kết quả đầy đủ trước tích hợp.

## Kết quả

- Chủ dự án chọn **Native**; bốn task đầu đã commit `ef744195`, `69e3577e`, `5add886d`, `a6c87687`; task 5 thêm probe và tích hợp check. [Log thực thi](../log/2026-10-28-slack-01-native.md).
- Sau fix ba P2 ngày 29/10, `npm run test:slack:foundation`: **56 Node + 49 schema = 105 test**, exit 0. `npm run check`: **2.558 test v3 + 406 test eval fixture + 1 launcher + 66 Node batch**, typecheck/build/quét build đạt, exit 0; PostgreSQL thật trên Docker project riêng.
- Inventory: **343** phương thức, **97** loại khỏi user-tool Free/Pro, **246** cần native probe; metadata user scopes được khai báo ở 254 trang. `verify` exit 0; bốn mutation omitted/duplicate/unreviewed/source_changed đều exit 1. Review metadata không phải native eligibility.
- Probe CLI: **11/11 checks**, `mode:fixture`, `verifiedLive:false`. Có hồi quy UTF-8 bị chia chunk, write đã commit trước timeout và phản hồi lỗi thiếu `ok:false` không được coi là bằng chứng từ chối.
- Review mới ở `99bd3866` tìm một Important: history mất cursor vẫn báo PASS. Hai regression HTTP thực thất bại trước sửa; sau sửa probe đạt **15/15**. Chặn `has_more:true` thiếu cursor và kiểm đủ ba seed Free. Native chỉ dùng một review; fix được tác giả kiểm bằng RED→GREEN và toàn suite, không gọi review lần hai.
- [Review tại181325b7](../log/2026-10-29-codex-review-slack-01-pr183.md) tìm ba P2; đã sửa ở `60965b20` và `a2b94b7b`: kiểm đúng tập nguồn/tác giả Free–Pro, đủ thread seed + receipt, và XML/hierarchy hợp lệ trước khi collection ghi snapshot. Fresh reviewer xác nhận **ĐẠT F1–F3, không còn P1/P2/P3 cần sửa**. [Log sửa và RED→GREEN](../log/2026-10-29-slack-01-p2-fixes.md). CI phải kiểm lại trên head mới trước tích hợp.
- Probe yêu cầu fresh fixture có fixed seeds; chạy lại cần tạo fixture mới. Kiểm public sitemap ngày29/10 thấy354 method (parser cũ/mới cùng354); snapshot343 giữ nguyên, 11 row phát sinh chờ refresh/review riêng.
- Browser local/model evaluation thật, OAuth/Slack live, app install và bật cờ: **NOT_RUN**, ngoài phạm vi card này. Root khai báo trực tiếp devDependency `saxes@6.0.0` đã có trong lockfile, không thêm package/version vào dependency tree; không đăng ký tool/service.

- Merge #183: `3d0edfa04bacee9eb364c29a1563d75831af5b22`, cây trùng head `ce08da98`; CI #40741479988 SUCCESS cả check/browser. [Log merge](../log/2026-10-29-reviewer-merge-183.md).
