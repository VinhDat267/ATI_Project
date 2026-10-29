# 29/10/2026 · SLACK-01B — Làm mới kiểm kê phương thức Slack API lên 354 phương thức

**Ủy quyền:** Điều phối viên giao nhiệm vụ cập nhật tài liệu kiểm kê theo đề xuất khảo sát (Reconnaissance). Chỉ thực hiện thay đổi tài liệu trong phạm vi thẻ SLACK-01B; không sửa code runtime, không gọi Slack API hay bật live.
**Nhánh:** `VinhDat267/slack-api-inventory-refresh`. **Nền:** `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac`.
**Task card:** `docs/handoff/tasks/SLACK-01B-inventory-refresh.md`.
**PR:** [#185](https://github.com/VinhDat267/ATI_Project/pull/185) (Draft).
**Tài liệu sửa đổi:** `docs/slack/method-inventory.json`, `docs/slack/method-inventory.md`.

---

## 1. Kết quả thay đổi

- **Cập nhật snapshot 354 phương thức:**
  - Thu thập sitemap chính thức `https://docs.slack.dev/sitemap.xml` (SHA256: `cdb9942404d682075921303e82dc858f27a3f52911042cdec76b9a9a95dd6d6b`, kích thước 329.263 bytes) qua collector HTTPS allowlist có giới hạn kết nối (tối đa 2 inflight, timeout 10 s).
  - Toàn bộ 343 phương thức trong snapshot cũ đều có mặt trong sitemap trực tiếp và giữ nguyên mã băm nguồn `sourceSha256` giống từng byte; các chú thích đã duyệt (`reviewed`) được bảo toàn tuyệt đối.
  - Toàn bộ nội dung tài liệu Markdown thô được lưu tạm tại thư mục bị ignore `.superpowers/slack-inventory-recon/cache/`, không commit nội dung thô có bản quyền vào kho mã.
  - Snapshot SHA256 chính xác của `docs/slack/method-inventory.json`: `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`.
- **Thẩm định & phân loại 11 phương thức mới:**
  - **4 phương thức Enterprise Admin (`admin.slackbot.skills.*`):**
    - `admin.slackbot.skills.list` (POST, t2, user scope `admin.skills:read`)
    - `admin.slackbot.skills.publish` (POST, t2, user scope `admin.skills:write`)
    - `admin.slackbot.skills.setAutoEnabled` (POST, t2, user scope `admin.skills:write`)
    - `admin.slackbot.skills.unpublish` (POST, t2, user scope `admin.skills:write`)
    - *Định đoạt:* `disposition: "excluded"`. Lý do: Cả 4 trang tài liệu đều mang banner chính thức chỉ dành cho Enterprise plan: *"The features within are only available to Slack workspaces on an Enterprise plan"*.
  - **7 phương thức Slackbot Skills người dùng (`slackbot.skills.*`):**
    - `slackbot.skills.create` (POST, t2, user scope `skills:write`, `write`, `medium` risk)
    - `slackbot.skills.delete` (POST, t2, user scope `skills:write`, `write`, `high` risk)
    - `slackbot.skills.info` (POST, t3, user scope `skills:read`, `read`, `low` risk)
    - `slackbot.skills.library.add` (POST, t3, user scope `skills:write`, `write`, `low` risk)
    - `slackbot.skills.library.remove` (POST, t3, user scope `skills:write`, `write`, `low` risk)
    - `slackbot.skills.list` (POST, t3, user scope `skills:read`, `read`, `low` risk)
    - `slackbot.skills.update` (POST, t3, user scope `skills:write`, `write`, `medium` risk)
    - *Định đoạt:* `disposition: "probe_required"`. Lý do: Khai báo user scopes hợp lệ, nhưng tính năng tổ chức (`feature_not_enabled`), phân quyền Canvas nền tảng giữa gói Free vs Pro và vai trò caller chưa được kiểm chứng thực tế; giữ nguyên `deliveryStatus: "not_implemented"`, `atiMapping: "SLACK-03/skills (planned; no tool registered)"`.
- **Số liệu thống kê toàn bộ kho kiểm kê sau làm mới:**
  - Tổng số phương thức canonical: **354** (tăng +11).
  - Phương thức có khai báo user scopes: **265** (tăng +11).
  - Phương thức không khai báo user scopes (`null`): **89** (không đổi).
  - Phương thức bị loại trừ khỏi Free/Pro: **101** (tăng +4, gồm 96 Enterprise, 3 deprecated/retired, 2 app-token).
  - Phương thức yêu cầu probe thực tế: **253** (tăng +7).
  - Công cụ đã triển khai hoặc hỗ trợ live: **0** (không đổi).
  - Tác dụng phụ (Side effects): 46 read, 33 write, 275 undetermined.
  - Mức độ rủi ro (Risks): 62 low, 2 medium, 15 high, 275 undetermined.
  - Toàn bộ 354 hàng đều có `reviewState: "reviewed"`, `deliveryStatus: "not_implemented"`.

---

## 2. Bằng chứng kiểm thử và lệnh thực tế

| Lệnh kiểm thử | Kết quả thực tế | Mã thoát |
|---|---|:---:|
| `node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json` | `{"mode":"documentation","methods":354,"dispositions":{"candidate":0,"excluded":101,"probe_required":253},"verifiedLive":false}` | `0` |
| `node --test scripts/slack/inventory.test.mjs` | **27 tests passed**, 0 fail, 0 skipped. Thời gian: 1198 ms. | `0` |
| `npm run test:slack:foundation` | **105 tests passed** (56 Node tests + 49 schema tests), 0 fail. | `0` |
| `git diff --check fc12e3fb HEAD` | **Exit 0**, hoàn toàn sạch trailing whitespace trên toàn bộ diff base-to-head. | `0` |

---

## 3. Nghiệm thu độc lập từ Điều phối viên (Coordinator Independent Review)

Điều phối viên đã chạy nghiệm thu độc lập tại commit `09d4ee88`:
- **Inventory source review:** **PASS** (toàn bộ 354 file Markdown được cache khớp từng byte `sourceSha256` và metadata trích xuất; toàn bộ 343 chú thích ban đầu giữ nguyên).
- **Fresh foundation test:** 56 Node + 49 schema = **105 passed**, exit 0.
- **Snapshot SHA256 chính xác:** `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`.
- **Finding whitespace & điều chỉnh bằng chứng:** Lệnh `git diff --check fc12e3fb HEAD` phát hiện 7 dòng có trailing spaces ở taskcard và handoff log (do ký tự xuống dòng markdown `  `). Ở commit sửa chữa này, toàn bộ 7 dòng đã được xóa trailing whitespace; lệnh `git diff --check fc12e3fb HEAD` đạt exit 0 chuẩn xác từ base tới head.
- **Quy chuẩn checklist:** Tiêu chí "test mới viết trước và fail trước khi sửa" là **N/A** (documentation refresh thuần túy không cần test runtime giả lập).

---

## 4. Giới hạn và các phạm vi không thực hiện

- **Native Slack API / OAuth live:** **NOT_RUN**, hoàn toàn nằm ngoài phạm vi thẻ tài liệu này. Không gọi Slack endpoint thật, không tạo Slack app và không kiểm tra token live.
- **Model evaluation / LLM prompt:** **NOT_RUN**, không đăng ký tool hay đưa bất kỳ phương thức nào vào prompt planner.
- **Local browser suite:** **NOT_RUN**, thẻ này là tài liệu kiểm kê độc lập, không thay đổi giao diện hay API web.
- **Không sửa đổi ngoài phạm vi:** Không sửa `apps/`, `packages/`, `CURRENT-STATE.md`, `ROADMAP.md` hay các worktree song song khác.
