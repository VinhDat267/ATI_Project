# SLACK-01B · Làm mới kiểm kê Slack API từ sitemap chính thức

**Trạng thái:** hoàn thành tài liệu kiểm kê 354 phương thức, đã mở Draft PR [#185](https://github.com/VinhDat267/ATI_Project/pull/185); chờ reviewer độc lập nghiệm thu.  
**Nhánh mã:** `VinhDat267/slack-api-inventory-refresh` · **Nền:** `fc12e3fb`.  
**Phụ thuộc:** SLACK-01 đã merge vào `main` tại `3d0edfa0` / `fc12e3fb`.  
**Tài liệu tham chiếu:** [Kiểm kê phương thức Slack](../../slack/method-inventory.md), [Nhật ký bàn giao SLACK-01B](../log/2026-10-29-slack-01b-inventory-refresh.md), [Đặc tả Slack cá nhân](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).

## Mục tiêu và phạm vi

Làm mới snapshot kiểm kê tài liệu Slack Web API (`docs/slack/method-inventory.json` và `docs/slack/method-inventory.md`) từ 343 lên 354 phương thức canonical dựa trên sitemap chính thức `https://docs.slack.dev/sitemap.xml`.

Phạm vi chỉ bao gồm tài liệu kiểm kê và hồ sơ bằng chứng (provenance). Bảo toàn toàn bộ chú thích đã review của 343 phương thức cũ khi mã băm nội dung khớp; thẩm định và chú thích đầy đủ 11 phương thức mới: 4 phương thức `admin.slackbot.skills.*` loại trừ (`excluded`) do mang banner Enterprise-only chính thức, 7 phương thức `slackbot.skills.*` người dùng yêu cầu probe (`probe_required`) do quyền hạn Free/Pro/Canvas và cờ tính năng chưa được xác minh trên thực tế.

Tuyệt đối không sửa mã runtime (`apps/`, `packages/`), không gọi Slack API thật, không tạo ứng dụng Slack, không đánh giá model LLM và không bật bất kỳ cờ live nào.

## Tiêu chí nghiệm thu

- [x] Sitemap chính thức và toàn bộ tài liệu Markdown được thu thập qua collector HTTPS allowlist có giới hạn kết nối (tối đa 2 inflight, timeout 10 s, retry có giới hạn).
- [x] Snapshot chứa đúng 354 phương thức canonical, khớp 100% với danh sách trích xuất từ sitemap trực tiếp.
- [x] 4 phương thức `admin.slackbot.skills.*` mang banner Enterprise-only chính thức được định đoạt `excluded`.
- [x] 7 phương thức `slackbot.skills.*` có khai báo user scopes được định đoạt `probe_required` kèm explicit unknowns về Free/Pro/Canvas/vai trò; không tự suy diễn quyền thực thi từ metadata.
- [x] Toàn bộ 354 hàng đều có `deliveryStatus: "not_implemented"`, `reviewState: "reviewed"`, không còn hàng `unreviewed` hay `source_changed`.
- [x] Số liệu thống kê: 354 tổng cộng, 265 có khai báo user scopes, 89 không khai báo user scopes (`null`), 101 loại trừ (`excluded`), 253 cần probe (`probe_required`), 0 công bố hỗ trợ live.
- [x] Lệnh kiểm định offline `node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json` đạt exit 0.
- [x] Bộ kiểm thử `node --test scripts/slack/inventory.test.mjs` (27/27 pass) và `npm run test:slack:foundation` (105/105 pass) đạt exit 0.
- [x] Tạo Draft PR theo mẫu của repository với đầy đủ số liệu và bằng chứng lệnh thực tế, kèm nhật ký bàn giao mới trong `docs/handoff/log/`.

## Kết quả

- Thu thập sitemap trực tiếp: 354 phương thức canonical (Sitemap SHA256 `cdb9942404d682075921303e82dc858f27a3f52911042cdec76b9a9a95dd6d6b`, 329.263 bytes). Toàn bộ 343 phương thức cũ giữ nguyên mã băm nguồn và chú thích đã review.
- Thẩm định 11 phương thức mới:
  - 4 Enterprise Admin skills (`admin.slackbot.skills.list`, `publish`, `setAutoEnabled`, `unpublish`): `disposition: "excluded"`, `reason` ghi rõ banner Enterprise plan từ trang chính thức.
  - 7 User skills (`slackbot.skills.create`, `delete`, `info`, `library.add`, `library.remove`, `list`, `update`): `disposition: "probe_required"`, user scopes `skills:write` / `skills:read`, ghi rõ các ẩn số về tính năng tổ chức (`feature_not_enabled`), phân quyền Canvas trên Free vs Pro và vai trò caller.
- `docs/slack/method-inventory.json` và `docs/slack/method-inventory.md` được cập nhật đồng bộ.
- Kiểm thử:
  - `node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json`: exit 0 (`methods: 354`, `excluded: 101`, `probe_required: 253`).
  - `node --test scripts/slack/inventory.test.mjs`: 27/27 pass, exit 0.
  - `npm run test:slack:foundation`: 105/105 pass, exit 0.
- Đã mở Draft PR [#185](https://github.com/VinhDat267/ATI_Project/pull/185) trên nhánh `VinhDat267/slack-api-inventory-refresh`.
- Native/live/model/browser: **NOT_RUN**, nằm ngoài phạm vi card này.
