# SLACK-01 · Contract nền, kiểm kê API và HTTP fixture

**Trạng thái:** có kế hoạch, chờ review kế hoạch/chọn cách thực thi; chưa code.
**Phụ thuộc:** thiết kế OAUTH-04 bản sửa `d479b098` đã được chủ dự án cho chuyển sang triển khai.
**Thiết kế:** [Slack cá nhân](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).
**Kế hoạch:** [Slack Personal Foundation](../../superpowers/plans/2026-10-28-slack-foundation.md), đọc hết cùng thiết kế trước khi làm.

## Mục tiêu và phạm vi

Thêm hợp đồng identity/source/policy, inventory từng phương thức có nguồn, fixture HTTP có state/phân quyền và probe offline chống nhầm bằng chứng live. Năm task nhỏ trong plan đều thuộc deliverable này. Schema thống nhất trước script/consumer; root package cần owner review.

Không route/API/UI Slack cá nhân, DB/OAuth/refresh thật, model, app install hay bật cờ trong card này. Các card 02–07 trong lộ trình của kế hoạch vẫn mở; không dùng card 01 để tuyên bố full Slack.

## Tiêu chí nghiệm thu

- [ ] Binding/source contract giữ đủ actor/workspace/generation; invalid/mismatch bị chặn.
- [ ] Policy dùng nguồn/model kiểm chấp thuận, provider và retention; không suy quyền từ OAuth.
- [ ] Inventory đủ row so với snapshot index, có provenance/requirements/disposition; chưa chứng minh thì ghi probe_required và reason.
- [ ] Fixture thật HTTP chứng minh scope, workspace/user, cursor và AbortSignal; timeout sau ghi không bị hiểu là chưa ghi.
- [ ] Probe chỉ loopback, từ chối redirect/live, không retry write UNKNOWN và không log token/body; report ghi verifiedLive false.
- [ ] RED→GREEN, test:slack:foundation/typecheck/check đạt; catalog và service cũ không thêm myslack.
- [ ] Reviewer độc lập, CI đúng head, log bàn giao và kết quả đầy đủ trước tích hợp.

## Kết quả

- Hiện chỉ có kế hoạch; tất cả tiêu chí triển khai ở trên **NOT_RUN**.
- Chưa chọn executor/method; đề xuất Native cho card nhỏ có interface liên quan chặt.
- Không có live credential, provider/model calls, app install hay thay đổi cấu hình.
