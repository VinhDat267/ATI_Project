# 29/10/2026 · Lập Kế hoạch và Soạn thảo Task Cards SLACK-03–07 (Hiệu chỉnh Thẩm định PR 188)

**Ủy quyền:** Chủ dự án và Trưởng nhóm điều phối / Reviewer (Coordinator) chỉ định Antigravity builder hoàn thiện kế hoạch chi tiết cho các task Slack còn lại (SLACK-03, 04, 05, 06, 07), khắc phục triệt để 4 nhóm lỗi hoạch định được chỉ ra trong đợt review PR 188 tại commit `4fbf9464`.
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Giữ nguyên 7 tài liệu kế hoạch, cùng nhánh/worktree/model. Tuyệt đối không sửa mã nguồn sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, `SLACK-01B` hoặc `SLACK-02`. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR.
**Nhánh làm việc:** `VinhDat267/docs-slack-remaining-roadmap` · **Base commit:** `fc12e3fb` (sau merge SLACK-01 #183).

---

## 1. Khắc phục Triệt để 4 Nhóm Ý kiến Thẩm định PR 188 (Review Findings at 4fbf9464)

### 1. Task 07B: Bỏ Gán Cứng Mô hình Runtime & Thiết lập Cổng Bằng chứng No-Training
- **Nguyên nhân lỗi:** Task 07B trước đó đã gán cứng mô hình runtime `gemini-3.8-flash`. Người dùng chỉ lựa chọn `gemini-3.8-flash-high` cho các agent lập trình Antigravity (Antigravity BUILDERS), đây hoàn toàn không phải là nhà cung cấp/mô hình được ủy quyền tiếp nhận hay xử lý nội dung Slack của khách hàng.
- **Biện pháp khắc phục:**
  - Loại bỏ hoàn toàn lựa chọn mô hình runtime gán cứng trong Task 07B và Task 16.
  - Thiết lập cổng kiểm soát: Nhà cung cấp và cấu hình đánh giá (evaluation provider/config) bắt buộc phải được lựa chọn tường minh và phải vượt qua cổng bằng chứng cam kết không dùng dữ liệu để huấn luyện và chính sách lưu trữ (organization/provider no-training + data retention evidence gates) TRƯỚC KHI thực hiện bất kỳ phép đánh giá nào trên nội dung nguồn hoặc dữ liệu người dùng.
  - Phân tách rõ ràng: Bộ harness ngoại tuyến trên dữ liệu tổng hợp (synthetic offline harness) được phép chạy; việc đánh giá trên dữ liệu live / nguồn thật cần văn bản ủy quyền cụ thể (concrete authorization).
  - Chỉ ghi nhận provider/model/version vào báo cáo đánh giá SAU KHI đã lựa chọn và phê duyệt chính thức, tuyệt đối không suy diễn từ mô hình builder.

### 2. Task 07D: Bảo toàn .env.example Default-Off & Quy trình Triển khai Cấu hình Có Tên
- **Nguyên nhân lỗi:** Kế hoạch trước đó coi việc chỉnh sửa biến trong `.env.example` thành `on` là phát hành / triển khai.
- **Biện pháp khắc phục:**
  - `.env.example` BẮT BUỘC BẢO TOÀN TRẠNG THÁI DEFAULT-OFF (`MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`).
  - Thay đổi phát hành (Release changes) chỉ áp dụng vào cấu hình triển khai có tên (named deployment configuration, ví dụ production/staging environment secrets config store) SAU KHI nghiệm thu P-LIVE hoàn tất, có quy trình rollback rõ ràng, trỏ vào đúng commit head đã qua review chính xác, và có sự ủy quyền tường minh từ người dùng (user authorization).
  - Quy định rõ: Các nhánh đã được chấp thuận trước đó có thể được xếp chồng (stacked branches) trước khi merge; việc cấp phát số thứ tự migration được thực hiện tuần tự sau reviewed backend head, không đòi hỏi user phải merge sớm vào main để tạo tiến độ.

### 3. Bảng Release Gates, Kiểm kê Toàn diện & Làm Rõ Điều kiện `search.*`
- **Nguyên nhân lỗi:** Bảng release table trước đó đòi hỏi 253 phương thức `probe_required` phải giữ nguyên vĩnh viễn trong khi lại tuyên bố toàn bộ năng lực đã được nghiệm thu live; đồng thời nhận định sai lệch rằng `search.*` "chỉ cần scope `search:read`".
- **Biện pháp khắc phục:**
  - Xóa bỏ yêu cầu vô lý "253 probe_required giữ nguyên mãi mãi". Độ bao phủ kiểm kê sử dụng tập phương thức snapshot đã duyệt (354 methods của PR 185), theo dõi trạng thái phân loại (`disposition`), phân phối (`deliveryStatus`), và bằng chứng native thực tế của từng phương thức; chủ động giải quyết qua bằng chứng hoặc giữ lại tường minh unknowns/exclusions. Mọi phương thức có tính đủ điều kiện chưa xác định (`unknown eligibility`) KHÔNG ĐƯỢC coi là đã nghiệm thu live (`not live accepted`).
  - Đối với `search.*`: Siêu dữ liệu scope (`search:read`) đứng riêng lẻ KHÔNG đủ để xác lập tính đủ điều kiện về token/role/plan trên môi trường native Slack; ghi nhận rõ ràng scope đã có trong tài liệu CỘNG VỚI các điều kiện bổ sung chưa xác định (unknown additional conditions / plan constraints), tuyệt đối không tuyên bố scope là điều kiện duy nhất.

### 4. Phân rã Đơn Quyền Sở hữu Task 05B/06C, Phân biệt Tệp Tương lai & Cô lập Credential
- **Nguyên nhân lỗi:** Task 05B và 06C gán nhiều code owner trong một child task; tệp tương lai `SlackProposalCard.tsx` (được tạo ở 06B) bị gán nhãn sai là `Modify (verified)` ở 06C; ranh giới giữa internal credential rows và public DTO chưa được phân định rành mạch.
- **Biện pháp khắc phục:**
  - Giữ Task 05B và 06C dưới dạng các nhóm phối hợp (Coordination Groups) được phân rã tường minh thành các task con / PR có ĐƠN QUYỀN SỞ HỮU (single-owner child cards/PRs) trước khi thi công, ưu tiên schema/interface trước:
    - Task 05B phân rã thành: 05B.1 (AI Engineer: Prompt & Triage Planner) và 05B.2 (Backend Engineer: Budget Tracker).
    - Task 06C phân rã thành: 06C.1 (AI Engineer: Cross-service plan templates), 06C.2 (Backend Engineer: Daily Digest Service), 06C.3 (Frontend Engineer: F3 UI Masking & Redaction).
  - Phân biệt rõ tệp tạo mới tương lai vs tệp hiện hữu: `apps/chat-web/src/components/slack/SlackProposalCard.tsx` là tệp tương lai do Task 06B tạo mới, sang Task 06C được đánh dấu chính xác là `Modify (future file created by Task 06B/Task 13)`, không dán nhãn `Modify (verified)`.
  - Cô lập tuyệt đối dòng chứng chỉ nội bộ: Các dòng chứng chỉ mã hóa nội bộ (`slack_connections` chứa `tokenEncrypted`) TUYỆT ĐỐI KHÔNG BAO GIỜ được đưa vào public DTO hoặc đầu vào của planner. Tầng phân giải kết nối (connection resolution) chỉ trả về validated binding và metadata sức khỏe kết nối (`SlackBinding`, `SlackConnectionMetadata`). Việc truy cập và giải mã token được cô lập hoàn toàn bên trong adapter / token manager tại thời điểm thực thi `executeStep`.

---

## 2. Kết quả Tự Kiểm tra Base-to-Head (Diff & Verification)

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Cú pháp Whitespace / Diff | `git diff --check fc12e3fb HEAD` | Clean, exit code 0 |
| Trạng thái Working Tree | `git status --porcelain` | Sạch sẽ, đúng 7 tệp tài liệu kế hoạch |
| Ranh giới Module | `git diff --name-only fc12e3fb HEAD` | 100% thuộc `docs/` |
| Bảo vệ Mã nguồn & Trạng thái | Kiểm tra `apps/`, `packages/`, `CURRENT-STATE.md`, `ROADMAP.md` | Không có bất kỳ thay đổi nào |

---

## 3. Bàn giao và Bước tiếp theo

1. Toàn bộ 7 tài liệu kế hoạch đã được đồng bộ hóa và cập nhật chính xác theo tất cả các yêu cầu thẩm định của Coordinator.
2. Commit các tệp đã sửa, thực hiện push thông thường lên nhánh `VinhDat267/docs-slack-remaining-roadmap` và cập nhật nội dung PR 188 trên GitHub.
3. Không bắt đầu thi công mã nguồn, không tự ý merge; tiếp tục chờ Reviewer / Coordinator thẩm định.
4. Gửi thông báo `worker_done` với Task ID `task_cca01d732e28` và Dispatch ID `ctx_afa212cb64bb`, sau đó chuyển sang trạng thái nhàn rỗi (idle).
