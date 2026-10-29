# SLACK-03B1 · Kho Lưu Trữ Nguồn, Kiểm Soát Truy Cập PostgreSQL & Hàng Đợi Vô Hiệu Hóa Bền Vững

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Nhóm trưởng duyệt; chưa thực thi code).
**Nhánh công việc dự kiến:** `feat/slack-03b1-source-store-and-invalidation`
**Nền đối chiếu:** `ce9380e9` (từ `integration/slack-personal-20261029`).
**Vai trò sở hữu:** Backend Engineer (chỉ sở hữu `apps/chat-api/` và `db/v3/`).
**Phụ thuộc:**
- **SLACK-01** (Foundation contracts `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02A** (`myslack-connection.ts` tại `6871087`) — ĐÃ HOÀN TẤT.
- **SLACK-02R** (Sửa cô lập callback tại PR #190) — ĐÃ HOÀN TẤT & ĐƯỢC CHẤP THUẬN.
- **SLACK-02B (Ứng viên PR #192, commit `4e038967`):** Đã hoàn tất 17 contract cases, `0016_slack_processing_consents.sql`, `SlackPolicyService` (kiểm tra purpose, `expectedPolicyReference` và revision matching), `SlackConsentRepo`, CLI `slack-consent`. Đang ở cổng CI cuối sau khi dọn dẹp khoảng trắng; root fullcheck 3.167 tại `5fb027ef` và 17 cases tại `4e038967` đã pass. Mã nguồn được đối chiếu chính xác qua `git show 4e038967:<path>`.
- **SLACK-03A (Ứng viên PR #194, commit `6e02ca56`):** Kết quả review độc lập kết luận "NEEDS WORK" (1 valid + 10 RED cases về zero-retention/raw 7-day bounds, lineage resource+policy epoch mismatches, và strict argument/schema detachment; đang được Schema Owner sửa đổi dưới context `ctx_3c64f98e0373`). Kế hoạch SLACK-03B1 được lập dựa trên các yêu cầu đã thống nhất chuẩn tắc (agreed requirements), KHÔNG giả định rằng bản `6e02ca56` được chấp thuận nguyên trạng mà không sửa đổi.
- **Cổng Xếp Chồng & Triển Khai (Prerequisite Review Gate):** Lập kế hoạch (Planning) tiến hành độc lập; việc thi công mã runtime bắt buộc chờ các giao diện 02B và 03A được chấp thuận (accepted interfaces) và staging base được review. Không viết bất kỳ mã runtime mới nào trong phiên planning này. Việc merge vào `main` không phải điều kiện tiên quyết cho các nhánh xếp chồng (stacked branches).
**Task cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này thiết lập hạ tầng kho lưu trữ dữ liệu nguồn thô (`slack_sources`), cơ chế kiểm soát truy cập (ACL) nghiêm ngặt tại mức cơ sở dữ liệu PostgreSQL (F2), cơ chế tính toán và áp đặt trần thời gian lưu trữ (TTL) do máy chủ quyết định, hàng đợi vô hiệu hóa và thu hồi bền vững (`slack_invalidation_intents`), cùng cơ chế xử lý sự kiện chính sách (policy events consumption) với ánh xạ epoch rào chắn (barrier epoch mapping) chính xác.

### 1.1. Ranh giới Phân tầng Bounded Scope (03B1 vs 03B2/03B3):
1. **Phạm vi của SLACK-03B1 (Card này):**
   - Bảng lưu trữ nguồn `slack_sources` có ACL đa cột, kiểm tra ràng buộc toàn vẹn và các chỉ mục phục vụ truy vấn có kiểm soát.
   - Cổng ghi nguyên tử (Atomic Write Gate) kết hợp kiểm tra binding, trạng thái kết nối active, consent granted và khớp số thứ tự sửa đổi (revision) trong cùng một câu lệnh SQL/giao dịch DB.
   - Cơ chế đọc có điều kiện (Conditional Read Guard) ngăn chặn tuyệt đối rò rỉ nội dung thô khi nguồn đã hết hạn, bị tombstone, hoặc sai lệch định danh.
   - Trần thời gian lưu trữ do máy chủ áp đặt (Server-Enforced TTL): tối đa 7 ngày cho nội dung thô (raw bodies), tối đa 30 ngày cho trích đoạn (excerpts); nghiêm cấm lưu trữ bền vững khi chính sách quy định `retentionDays === 0`.
   - Hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`) ghi nhận ngay trong cùng transaction với thay đổi kết nối/chính sách, hỗ trợ phân phối khóa hàng đợi `FOR UPDATE SKIP LOCKED`, gia hạn lease và phục hồi sau sự cố sập tiến trình.
   - Tiêu thụ sự kiện chính sách tổ chức từ 02B (`slack_policy_events`) với ngữ nghĩa epoch rào chắn (Barrier Epoch Mapping): số thứ tự sửa đổi trong sự kiện là trạng thái **SAU** khi thay đổi; vô hiệu hóa chính xác các bản ghi cũ mà không làm ảnh hưởng đến các bản ghi được cấp quyền lại (regrant) về sau.
2. **Không tuyên bố hoàn thành F3 ở 03B1:**
   - Việc tạo bảng và dịch vụ lưu trữ nguồn **KHÔNG ĐỒNG NGHĨA** với việc hoàn tất F3.
   - Toàn bộ cơ chế cascade purge vào các bản sao phái sinh (derived copies) trong lịch sử trò chuyện (`messages`), bộ nhớ làm việc (`working_memory`), tham số kế hoạch (`plan_json`, `execution_steps`), và lịch chạy tự động (`schedules`, `schedule_runs`) là phạm vi yêu cầu tường minh của **SLACK-03B2+**.
   - Cơ chế gắn kết binding và kiểm tra hash trước khi dispatch của Executor thuộc phạm vi **SLACK-03B3**.
   - Các công cụ đọc nội dung và tiêu thụ nguồn tuyệt đối không được kích hoạt live khi luồng F3 đầu-cuối chưa hoàn tất.

---

## 2. Ranh giới Sở hữu Module & Điểm Tích Hợp (Module Ownership)

Tuân thủ nghiêm ngặt ranh giới tại [`docs/team-workflow.md`](../../team-workflow.md):
- **Backend Engineer sở hữu độc quyền:**
  - `apps/chat-api/src/db/repositories/slack-source-repo.ts` (Tạo mới)
  - `apps/chat-api/src/services/slack/slack-source-store.ts` (Tạo mới)
  - `apps/chat-api/src/services/slack/slack-invalidation-service.ts` (Tạo mới)
  - `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts` (Tạo mới)
  - `apps/chat-api/tests/db/slack-source-repo.test.ts` (Tạo mới)
  - `apps/chat-api/tests/services/slack/slack-source-store.test.ts` (Tạo mới)
  - `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts` (Tạo mới)
  - `db/v3/[proposed: NNNN_slack_source_store.sql]` (Tạo mới; số thứ tự di trú đề xuất NNNN cho đến khi được nhóm trưởng/điều phối viên cấp phát chính thức sau reviewed backend head `0016`).
- **Không sửa đổi chéo (Cross-Editing Prohibited):**
  - Tuyệt đối không chỉnh sửa `packages/tool-schemas/` (do AI/Schema Engineer sở hữu).
  - Tuyệt đối không chỉnh sửa `packages/tool-adapters/` (do Adapter Engineer sở hữu).
  - Tuyệt đối không chỉnh sửa `packages/planner/` hay `prompts/` (do AI Engineer sở hữu).
  - Tuyệt đối không chỉnh sửa `apps/chat-web/` (do Frontend Engineer sở hữu).

---

## 3. Điều Tra Thực Tế: 7 Nhóm Bản Sao Dữ Liệu Nguồn & Trách Nhiệm Tiêu Thụ

Đối chiếu trực tiếp mã nguồn và cơ sở dữ liệu hiện hữu (`db/v3/0001_v3_core.sql`, `0010_schedules.sql`, `chat-service.ts`), hệ thống nhận diện chính xác 7 nhóm mục tiêu (Target Kinds) chứa dữ liệu nguồn hoặc bản sao phái sinh:

| Nhóm mục tiêu | Vị trí lưu trữ hiện hữu trong DB / Bộ nhớ | Bản chất dữ liệu nguồn lưu giữ | Trách nhiệm của bên tiêu thụ (Consumer Obligations) | Bên sở hữu module |
|---|---|---|---|---|
| **1. History** | Bảng `messages` (`role IN ('user', 'assistant', 'system', 'summary')`, cột `content`, `metadata`) | Trích đoạn tin nhắn, danh sách kênh, kết quả tra cứu Slack được hiển thị cho người dùng | Lưu giữ `sourceRefs` và `policyRef` trong `metadata`. Khi nguồn bị tombstone/purge, consumer phải ẩn/redact toàn bộ khối nội dung không thể bóc tách an toàn | Backend (`apps/chat-api`) |
| **2. Memory** | Bảng `messages` với `metadata->>'type' = 'working_memory'`, cột `metadata->'state'` | Trạng thái bộ nhớ làm việc qua các lượt hội thoại (chứa `__observed` IDs, thread participants, nhãn tin nhắn) | Ghi nhận provenance nguồn vào cấu trúc state. Khi nguồn bị thu hồi, bộ lọc memory của planner phải loại bỏ entity khỏi prompt | AI Planner (`packages/planner`) & Backend |
| **3. Plan Args** | Bảng `plans` (`plan_json`, `plan_text`) và `execution_steps` (`args_json`, `output_json`) | Tham số các bước thực thi workflow chứa nội dung tin nhắn, ID kênh, dữ liệu Slack | Bắt buộc đối chiếu `sameSlackBinding` và kiểm tra tính hợp lệ của nguồn trước khi dispatch; đánh dấu `skipped`/`purged` nếu nguồn bị vô hiệu | Backend & Executor (`packages/executor`) |
| **4. Proposals** | *Chưa có bảng vật lý* (Kế hoạch SLACK-06A tại `slack_proposals`) | Đề xuất hành động chờ người dùng duyệt trong cockpit | Không viết SQL purge giả tạo cho bảng chưa tồn tại; đặc tả nghĩa vụ schema tương lai: mọi proposal phải mang `sourceRefs` và bị hủy tự động nếu nguồn bị tombstone | Backend & Frontend (SLACK-06) |
| **5. Digest** | *Chưa có bảng vật lý* (Kế hoạch SLACK-06C tại `slack_digests` / cache) | Bản tin tóm tắt tổng hợp từ nhiều kênh/tin nhắn Slack | Ghi nhận danh sách `sourceRefs` cấu thành; khi 1 nguồn thành phần bị purge do vi phạm chính quyền/consent, toàn bộ digest liên quan phải bị ẩn hoặc tái lập | Backend & AI Planner (SLACK-06) |
| **6. Schedules** | Bảng `schedules` (`request`, `recurrence`, `services`) và `schedule_runs` (`plan_id`, `status`) | Yêu cầu định kỳ có thể trích dẫn nội dung Slack hoặc phụ thuộc kênh Slack | Khi mất quyền kênh (`channel_membership_lost`) hoặc ngắt kết nối, schedule chuyển `paused` kèm `pause_reason = 'slack_binding_invalid'` | Backend (`apps/chat-api/src/services/schedules/`) |
| **7. Audit** | Bảng `execution_steps` (`error_json`, `duration_ms`), audit logs | Nhật ký kiểm toán kỹ thuật và đối soát bảo mật | Nhật ký kiểm toán chỉ lưu metadata an toàn (IDs, timestamp, status), tuyệt đối không lưu nội dung thô PII | Backend (`apps/chat-api`) |

### 3.1. Ranh giới Phân đoạn Provenance (Provenance Segment Boundary):
- **Phân đoạn Đơn lẻ vs Bằng chứng Đầy đủ:** Khái niệm `DerivedCopyRef` chỉ đại diện cho **MỘT** phân đoạn ủy quyền với full-binding cụ thể (1 user, 1 connection, 1 workspace, 1 Slack actor, 1 identityVersion).
- **Trách nhiệm Tổng hợp Phân đoạn ở SLACK-03B2+:** Đối với các mục tiêu phái sinh trải rộng trên nhiều workspace hoặc tổng hợp từ nhiều nguồn dữ liệu khác nhau (ví dụ: bản tin Daily Digest gom tin từ Workspace A và Workspace B, hoặc kế hoạch workflow cross-workspace), bên tiêu thụ 03B2 bắt buộc phải **tổng hợp TOÀN BỘ các phân đoạn ủy quyền tương ứng (aggregate ALL segments)**.
- **Tái thẩm định Mọi Phụ thuộc (Revalidate Every Dependency):** Trước khi hiển thị trên giao diện hoặc đưa vào prompt cho model, consumer phải tái thẩm định tính hợp lệ của từng phân đoạn thành phần qua `SlackPolicyService`. Tuyệt đối không coi một phân đoạn đơn lẻ là bằng chứng provenance hoàn chỉnh cho toàn bộ artifact phái sinh phức hợp. Nếu bất kỳ phân đoạn nào bị thu hồi hoặc tombstone, toàn bộ khối nội dung không thể bóc tách an toàn phải bị ẩn hoặc loại bỏ.

---

## 4. Thiết Kế Kỹ Thuật Chi Tiết (SLACK-03B1)

### 4.1. Mô hình Tham chiếu Chính sách 8 Trường & Phân Tách Mục Đích Lưu Trữ
- Bản ghi nguồn lưu giữ bộ tham chiếu chính sách chuẩn tắc 8 trường (`SlackPolicyReference`):
  1. `binding`: `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`).
  2. `purpose`: Chuẩn hóa cố định là `'storage'` cho tham chiếu lưu trữ bất biến.
  3. `requestedRetentionDays`: Số nguyên an toàn dương (`> 0`).
  4. `providerProfileId`: Khớp định danh provider runtime từ cấu hình server.
  5. `configFingerprint`: Vân tay cấu hình provider runtime.
  6. `policyVersion`: Chuỗi phiên bản chính sách tổ chức được chấp thuận.
  7. `consentRevision`: Chuỗi thập phân dương chuẩn tắc (`/^[1-9][0-9]*$/`).
  8. `providerRevision`: Chuỗi thập phân dương chuẩn tắc (`/^[1-9][0-9]*$/`).
- **Nguyên tắc phân tách mục đích (Purpose Separation):** Tham chiếu lưu trữ `'storage'` là bất biến, đại diện cho bằng chứng thẩm định tại thời điểm thu thập dữ liệu vào DB. Khi một consumer (như `manual_lookup`, `triage`, `planning`, `digest`) đọc nguồn ra để sử dụng, consumer phải tự thực hiện một ủy quyền riêng biệt qua `SlackPolicyService.resolveSlackModelPolicy` với `purpose` của chính mình. Tuyệt đối không dán nhãn lại (relabel) purpose của bản ghi lưu trữ hoặc gán dữ liệu cũ vào ủy quyền mới.

### 4.2. Kiểm Soát Truy Cập PostgreSQL Nguyên Tử (Atomic Database ACL)
- Tuyệt đối không dùng cơ chế kiểm tra boolean ở tầng ứng dụng rồi mới INSERT (tránh race window).
- Phép INSERT vào `slack_sources` được thực thi dưới dạng `INSERT ... SELECT ...` kết hợp truy vấn kiểm tra nguyên tử:
  - `slack_connections.id = $connectionId AND slack_connections.user_id = $atiUserId AND slack_connections.status = 'active' AND slack_connections.identity_version = $identityVersion`
  - `slack_processing_consents.workspace_id = $workspaceId AND slack_processing_consents.status = 'granted' AND slack_processing_consents.revision = $consentRevision`
  - `slack_trusted_providers.id = $providerProfileId AND slack_trusted_providers.verified = true AND slack_trusted_providers.no_training = true AND slack_trusted_providers.revision = $providerRevision`
  - Nếu bất kỳ điều kiện nào không thỏa mãn (ví dụ người dùng vừa ngắt kết nối hoặc tổ chức vừa thu hồi quyền), câu lệnh trả về 0 row chèn, giao dịch rollback fail-closed.
- Khóa nguồn phức hợp duy nhất cho từng chủ sở hữu (`owner_source_key`): định dạng tuple JSON phân tách rõ ràng người dùng ATI và phiên bản định danh. Hai người dùng ATI khác nhau trong cùng workspace kết nối cùng 1 message Slack sẽ có 2 row độc lập, cách ly hoàn toàn; hành động của người A không ảnh hưởng tới người B.

### 4.3. Quy Định Trần Thời Gian Lưu Trữ (Server-Enforced TTL)
- Thời gian lưu trữ hiệu dụng được tính toán tại server:
  `effectiveDays = min(requestedDays, consent.retention_days, provider.max_retention_days, CEILING_DAYS)`
- Trần lưu trữ theo phân loại:
  - Nội dung thô (`raw bodies`): Tối đa **7 ngày** (`MAX_RAW_BODY_RETENTION_DAYS = 7`).
  - Trích đoạn (`excerpts`): Tối đa **30 ngày** (`MAX_EXCERPT_RETENTION_DAYS = 30`).
- Trường hợp chính sách hoặc nhà cung cấp quy định retention là 0: Cho phép xử lý trong bộ nhớ tức thời (in-memory processing), **NGHIÊM CẤM LƯU TRỮ BỀN VỮNG** (`retention_zero_denied`).
- Máy chủ gán `expires_at = captured_at + interval '... days'`; client gửi `expiresAt` tự chế sẽ bị bỏ qua hoàn toàn.

### 4.4. Hàng Đợi Ý Định Vô Hiệu Hóa & Thu Hồi Bền Vững (Durable Invalidation Queue)
- Bảng `slack_invalidation_intents` lưu vết mọi yêu cầu vô hiệu hóa dữ liệu.
- Cam kết bất biến: Khi có sự kiện ngắt kết nối cục bộ (`disconnect`), thay đổi thế hệ (`identityVersion` increment), hoặc nhận sự kiện thu hồi consent từ tổ chức, ý định vô hiệu hóa phải được INSERT vào bảng `slack_invalidation_intents` **trong cùng giao dịch cơ sở dữ liệu**. Phải bắt (capture) binding CŨ trước khi tăng version.
- Việc gọi API thu hồi token lên Slack (`auth.revoke`) chỉ mang tính best-effort và không được phép rollback việc bảo vệ dữ liệu cục bộ nếu gặp sự cố mạng.
- Xử lý hàng đợi sử dụng `SELECT ... FOR UPDATE SKIP LOCKED` với thời hạn lease hữu hạn (ví dụ 60 giây) và cơ chế thử lại có giới hạn (`max_retries = 5`), hỗ trợ tự phục hồi khi tiến trình đột tử.
- Độc lập với cờ tính năng (F4 Invariant): Hàng đợi và poller dọn dẹp vô hiệu hóa hoạt động liên tục ngay cả khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace bị tạm dừng.

### 4.5. 5 Nhãn Phạm Vi Vô Hiệu Hóa Từ 03A (Tagged Invalidation Scopes)
1. `owner_retention`: Hết hạn TTL theo thời gian lưu trữ được phê duyệt.
2. `channel_membership_lost`: Người dùng rời khỏi kênh hoặc bị thu hồi quyền truy cập kênh. Chỉ tombstone các tài nguyên thuộc kênh đó của người dùng đó; không ảnh hưởng các kênh khác.
3. `authorization_disconnect`: Người dùng chủ động ngắt kết nối hoặc gỡ cài đặt app. Tombstone toàn bộ nguồn thuộc binding cụ thể đó; không xóa dữ liệu hợp lệ của người dùng khác trong cùng workspace.
4. `resource_lifecycle`: Tin nhắn bị xóa (`source_deleted`) hoặc chỉnh sửa (`source_edited`) trên Slack. Vô hiệu hóa revision cũ cho toàn bộ các bản sao có quyền; không tự ý liên kết lại dữ liệu mới dựa trên tên.
5. `workspace_consent_revocation`: Tổ chức thu hồi consent xử lý dữ liệu cho workspace và provider tương ứng.

### 4.6. Ngữ Nghĩa Ánh Xạ Epoch Rào Chắn (Barrier Epoch Mapping)
- Cột `slack_policy_events.consent_revision` của SLACK-02B đại diện cho số thứ tự sửa đổi **SAU** khi trạng thái thay đổi.
  - *Ví dụ luồng thực tế:*
    1. Cấp quyền lần 1: `consent.revision = 1` -> Nguồn lưu trữ mang `consentRevision = '1'`.
    2. Thu hồi quyền: Tạo sự kiện trong `slack_policy_events` với `event_type = 'consent_revoked'`, `consent_revision = 2`.
    3. Cấp quyền lại lần 2: `consent.revision = 3` -> Nguồn mới lưu trữ mang `consentRevision = '3'`.
  - *Nguy cơ sai lệch:* Nếu poller xử lý sự kiện thu hồi (bước 2) chạy chậm trễ sau khi bước 3 đã xảy ra, nếu so khớp theo workspace thuần túy sẽ xóa oan nguồn mới của bước 3; nếu so khớp chính xác bằng (`consent_revision = 2`) sẽ không xóa được nguồn nào vì nguồn cũ mang revision 1.
  - *Giải pháp Rào Chắn Chuẩn Tắc (Barrier Semantics):*
    Sự kiện thu hồi với revision $R_{event}$ thiết lập một rào chắn vô hiệu hóa tất cả các bản ghi nguồn có:
    `workspace_id = event.workspace_id AND provider_profile_id = event.provider_id AND consent_revision < event.consent_revision`
    Các bản ghi nguồn mới được tạo sau đó mang `consent_revision >= event.consent_revision` (như revision 3) **ĐƯỢC BẢO TOÀN NGUYÊN VẸN**.

---

## 5. Danh Mục File Thi Công & Test Dự Kiến

### 5.1. File Mã Nguồn (Backend Owner):
1. `db/v3/[proposed: NNNN_slack_source_store.sql]`:
   - Bảng `slack_sources` và các chỉ mục toàn vẹn.
   - Bảng `slack_invalidation_intents` và chỉ mục hàng đợi.
2. `apps/chat-api/src/db/repositories/slack-source-repo.ts`:
   - Lớp repository tương tác trực tiếp PostgreSQL: insert atomic gate, query by owner with ACL, query active, soft tombstone, mark purged, list expired.
3. `apps/chat-api/src/services/slack/slack-source-store.ts`:
   - Dịch vụ quản lý vòng đời nguồn: kiểm tra policy qua `SlackPolicyService`, áp đặt trần TTL (7 ngày / 30 ngày), sanitize metadata, chuyển đổi DTO an toàn.
4. `apps/chat-api/src/services/slack/slack-invalidation-service.ts`:
   - Dịch vụ quản lý ý định vô hiệu hóa: enqueue transactional intent, worker claim bằng `FOR UPDATE SKIP LOCKED`, thực thi tombstone theo 5 tagged scopes, xử lý lease timeout và crash recovery.
5. `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts`:
   - Dịch vụ tiêu thụ `slack_policy_events`: thực thi barrier epoch mapping, chuyển hóa sự kiện chính sách thành invalidation intents.

### 5.2. File Kiểm Thử Tích Hợp (Real PostgreSQL Fixtures):
1. `apps/chat-api/tests/db/slack-source-repo.test.ts`:
   - Kiểm thử ràng buộc bảng, kiểm thử atomic write gate (rollback khi connection inactive hoặc consent missing), kiểm thử phân tách 2 user cùng workspace.
2. `apps/chat-api/tests/services/slack/slack-source-store.test.ts`:
   - Kiểm thử áp đặt trần TTL, kiểm thử từ chối lưu trữ khi retention = 0, kiểm thử che giấu nội dung thô khi tombstone/hết hạn.
3. `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`:
   - Kiểm thử concurrency với `SKIP LOCKED`, kiểm thử phục hồi sau lease timeout, kiểm thử 5 tagged scopes, kiểm thử hủy bằng `AbortSignal`.
4. `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`:
   - Kiểm thử barrier epoch mapping trên PostgreSQL thật (Grant 1 -> Revoke 2 -> Regrant 3; chứng minh nguồn 1 bị xóa, nguồn 3 tồn tại).

---

## 6. Kế Hoạch Chạy Kiểm Thử TDD (RED → GREEN)

```bash
# 1. Chạy suite kiểm thử repository DB (Kỳ vọng RED khi chưa có migration và code)
npm test -w @wap/chat-api -- tests/db/slack-source-repo.test.ts

# 2. Chạy suite kiểm thử dịch vụ lưu trữ nguồn
npm test -w @wap/chat-api -- tests/services/slack/slack-source-store.test.ts

# 3. Chạy suite kiểm thử dịch vụ hàng đợi vô hiệu hóa
npm test -w @wap/chat-api -- tests/services/slack/slack-invalidation-service.test.ts

# 4. Chạy suite kiểm thử tiêu thụ sự kiện chính sách & barrier epoch mapping
npm test -w @wap/chat-api -- tests/services/slack/slack-policy-event-consumer.test.ts

# 5. Kiểm tra typecheck toàn bộ dự án
npm run typecheck:v3

# 6. Kiểm tra quy chuẩn khoảng trắng và diff
git diff --check ce9380e9
```

---

## 7. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [ ] Migration đề xuất tạo đúng bảng `slack_sources` và `slack_invalidation_intents` với đầy đủ foreign keys, constraints và indexes. Số thứ tự migration `NNNN` không xung đột với các PR song song.
- [ ] Ghi nguồn vào DB bắt buộc thực hiện qua cổng nguyên tử (Atomic Write Gate), thẩm định đồng thời connection, consent, provider và revision; không có cửa sổ race condition.
- [ ] Tham chiếu lưu trữ mang `purpose = 'storage'` bất biến với 8 trường chuẩn tắc. Revisions là chuỗi thập phân dương chuẩn tắc (`/^[1-9][0-9]*$/`).
- [ ] Hai người dùng ATI khác nhau cùng kết nối một workspace/kênh/tin nhắn được cách ly hoàn toàn qua `owner_source_key`.
- [ ] Máy chủ áp đặt trần TTL nghiêm ngặt: tối đa 7 ngày cho nội dung thô, 30 ngày cho trích đoạn. Chính sách quy định retention = 0 bị từ chối lưu trữ bền vững.
- [ ] Hàng đợi ý định vô hiệu hóa được ghi nhận trong cùng transaction với thay đổi kết nối/chính sách.
- [ ] Worker phân phối job sử dụng `FOR UPDATE SKIP LOCKED`, có lease timeout và retry giới hạn, tự phục hồi sau khi sập tiến trình.
- [ ] Ánh xạ epoch rào chắn (Barrier Epoch Mapping) chứng minh thành công trên PostgreSQL thật: sự kiện thu hồi (revision 2) chỉ vô hiệu hóa các bản ghi cũ (< 2), bảo toàn nguyên vẹn bản ghi được cấp quyền lại (revision 3).
- [ ] Không có thay đổi nào xâm phạm ranh giới của các package khác (`@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/chat-web`).
- [ ] Báo cáo đầy đủ 7 nhóm bản sao dữ liệu nguồn và giao diện cam kết cho các giai đoạn SLACK-03B2/03B3 tiếp theo.

---

## 8. Kết Quả Thực Thi (Execution Results)

*(Phần này sẽ được agent thi công điền sau khi hoàn tất triển khai mã nguồn và thu thập đầy đủ bằng chứng kiểm thử thực tế).*
