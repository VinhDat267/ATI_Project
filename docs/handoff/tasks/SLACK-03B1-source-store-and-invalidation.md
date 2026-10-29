# SLACK-03B1 · Kho Lưu Trữ Nguồn, Kiểm Soát Truy Cập PostgreSQL & Hàng Đợi Vô Hiệu Hóa Bền Vững

**Trạng thái:** DỰ THẢO KẾ HOẠCH — ĐÃ CẬP NHẬT THEO ĐÁNH GIÁ ĐỘC LẬP (Chờ Reviewer & Nhóm trưởng duyệt; chưa thực thi code runtime).
**Nhánh công việc dự kiến:** `docs/slack-03b1-source-plan` (PR #196)
**Nền đối chiếu:** `ce9380e9` (từ `integration/slack-personal-20261029`).
**Vai trò sở hữu:** Backend Engineer (sở hữu `apps/chat-api/` và `db/v3/`).
**Phụ thuộc:**
- **SLACK-01** (Foundation contracts `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02A** (`myslack-connection.ts` tại `6871087`) — ĐÃ HOÀN TẤT.
- **SLACK-02R** (Sửa cô lập callback tại PR #190) — ĐÃ HOÀN TẤT & ĐƯỢC CHẤP THUẬN.
- **SLACK-02B (Ứng viên PR #192, commit `4e038967`):** Đã hoàn tất 17 contract cases, `0016_slack_processing_consents.sql`, `SlackPolicyService` (kiểm tra purpose, `expectedPolicyReference` và revision matching), `SlackConsentRepo`, CLI `slack-consent`. Đang ở cổng CI cuối sau khi dọn dẹp khoảng trắng; root fullcheck 3.167 tại `5fb027ef` và 17 cases tại `4e038967` đã pass. Mã nguồn được đối chiếu chính xác qua `git show 4e038967:<path>`.
- **SLACK-03A (Ứng viên PR #194, commit `6e02ca56`):** Đang khắc phục các ca lỗi đánh giá độc lập dưới context `ctx_3c64f98e0373` (10 RED cases về bounds retention, raw 7 ngày, lineage epoch mismatches và argument detachment). Kế hoạch SLACK-03B1 được chuẩn hóa theo các yêu cầu chuẩn tắc đã thống nhất (agreed requirements), KHÔNG giả định rằng bản `6e02ca56` được chấp thuận nguyên trạng mà không sửa đổi.
- **Cổng Xếp Chồng & Triển Khai (Prerequisite Review Gate):** Lập kế hoạch (Planning) tiến hành độc lập; việc thi công mã runtime bắt buộc chờ các giao diện 02B và 03A được chấp thuận (accepted interfaces) và staging base được review. Tuyệt đối không viết mã runtime mới trong phiên planning này.
**Task cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này thiết lập hạ tầng kho lưu trữ dữ liệu nguồn thô (`slack_sources`), cơ chế kiểm soát truy cập (ACL) tuần tự hóa nghiêm ngặt trên PostgreSQL MVCC (F2), cơ chế tính toán và áp đặt trần thời gian lưu trữ (TTL) do máy chủ quyết định, hàng đợi vô hiệu hóa và thu hồi bền vững (`slack_invalidation_intents`), cùng cơ chế xử lý sự kiện chính sách (policy events consumption) với ánh xạ epoch rào chắn (barrier epoch mapping) chính xác.

### 1.1. Ranh giới Phân tầng Bounded Scope (03B1 vs 03B2/03B3):
1. **Phạm vi của SLACK-03B1 (Card này):**
   - Bảng lưu trữ nguồn thô `slack_sources` chỉ lưu trữ dữ liệu nguồn nguyên bản (raw data), áp đặt trần cứng `<= 7 ngày` cho **MỌI** loại tài nguyên thô (`conversation`, `message`, `file`, v.v.). Loại bỏ hoàn toàn cờ `isExcerpt` khỏi kho nguồn thô; trích đoạn 30 ngày thuộc về lớp lưu trữ có kiểu riêng biệt tại **SLACK-03B2**.
   - Cổng ghi nguyên tử (Atomic Write Gate) kết hợp khóa dòng tường minh (`FOR SHARE` trên `slack_connections` và `slack_processing_consents`), tuần tự hóa tuyệt đối với các giao dịch `revokeConsent` (`FOR UPDATE`) của 02B dưới PostgreSQL MVCC; kiểm tra đầy đủ 5 trường binding, quyền mục đích `'storage'`, giới hạn retention và số thứ tự sửa đổi (revision) hiện hành.
   - Cơ chế đọc an toàn `getSource`: bắt buộc cung cấp đầy đủ 5 trường binding, định danh capture/revision chính xác; tái thẩm định trạng thái kết nối, consent, provider live và mục đích tiêu thụ riêng biệt (`'manual_lookup' | 'triage' | 'planning' | 'digest'`); tra cứu rào chắn vô hiệu hóa bền vững (`slack_invalidation_barriers`) để chặn đọc **NGAY LẬP TỨC** trước khi tiến trình purge/ACK bất đồng bộ diễn ra.
   - Hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`) ghi nhận ngay trong cùng transaction với thay đổi kết nối/chính sách/ingress, hỗ trợ phân phối khóa hàng đợi `FOR UPDATE SKIP LOCKED`, gia hạn lease và phục hồi sau sự cố sập tiến trình.
   - Tiêu thụ sự kiện chính sách tổ chức từ 02B (`slack_policy_events`) bảo đảm tính lũy thừa (idempotency) qua khóa nhận dạng duy nhất (`policy_event_id`), không gây trùng lặp, xử lý đầy đủ 4 loại sự kiện và mở rộng rào chắn sau thay đổi (after-change barrier) thành các mục tiêu thu hồi cũ chính xác mà không làm ảnh hưởng đến các bản ghi được cấp quyền lại (regrant) về sau.
   - Giao diện vô hiệu hóa liên kết giao dịch (Transaction-Bound Invalidation Interface) chuẩn bị cho webhook ingress 04A: cam kết receipt + rào chắn được commit nguyên tử, chặn đọc trước khi gửi HTTP 200 ACK cho Slack.
2. **Không tuyên bố hoàn thành F3 ở 03B1:**
   - Việc tạo bảng và dịch vụ lưu trữ nguồn **KHÔNG ĐỒNG NGHĨA** với việc hoàn tất F3.
   - Toàn bộ cơ chế cascade purge vào các bản sao phái sinh (derived copies) trong lịch sử trò chuyện (`messages`), bộ nhớ làm việc (`working_memory`), tham số kế hoạch (`plan_json`, `execution_steps`), và lịch chạy tự động (`schedules`, `schedule_runs`) là phạm vi yêu cầu tường minh của **SLACK-03B2+**.
   - Cơ chế gắn kết binding và kiểm tra hash trước khi dispatch của Executor thuộc phạm vi **SLACK-03B3**.
   - Các công cụ đọc nội dung và tiêu thụ nguồn tuyệt đối không được kích hoạt live khi luồng F3 đầu-cuối chưa hoàn tất.

---

## 2. Ranh giới Sở hữu Module & Điểm Tích Hợp (Module Ownership)

Tuân thủ nghiêm ngặt ranh giới tại [`docs/team-workflow.md`](../../team-workflow.md):
- **Backend Engineer sở hữu độc quyền:**
  - `apps/chat-api/src/db/repositories/slack-source-repo.ts` (Tạo mới: Atomic Write Gate với row locks, getSource có ACL & barrier guard, soft tombstone, purge, query expired)
  - `apps/chat-api/src/services/slack/slack-source-store.ts` (Tạo mới: Dịch vụ lưu trữ & trích xuất nguồn thô, áp trần TTL 7 ngày máy chủ, tái thẩm định chính sách khi đọc)
  - `apps/chat-api/src/services/slack/slack-invalidation-service.ts` (Tạo mới: Hàng đợi ý định vô hiệu hóa, rào chắn đọc tức thì, claim worker `SKIP LOCKED`, crash recovery)
  - `apps/chat-api/src/services/slack/slack-invalidation-runner.ts` (Tạo mới: Tiến trình nền định kỳ quét expiration & barrier purge, chạy độc lập với cờ automation)
  - `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts` (Tạo mới: Bộ tiêu thụ sự kiện chính sách lũy thừa, mở rộng rào chắn epoch)
  - `apps/chat-api/src/db/repositories/slack-connection-repo.ts` (Tích hợp: Bắt binding CŨ trong transaction disconnect và ghi nhận ý định vô hiệu hóa)
  - `apps/chat-api/src/app.ts` (Tích hợp: Khởi động runner dọn dẹp nguồn thô độc lập với cờ tính năng)
  - `db/v3/[proposed: NNNN_slack_source_store.sql]` (Tạo mới: DDL bảng `slack_sources`, `slack_invalidation_barriers`, `slack_invalidation_intents`)
  - `apps/chat-api/tests/db/slack-source-repo.test.ts` (Tạo mới: Integration tests khóa dòng và concurrency race)
  - `apps/chat-api/tests/services/slack/slack-source-store.test.ts` (Tạo mới: Tests trần TTL 7 ngày và revalidation khi đọc)
  - `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts` (Tạo mới: Tests claim `SKIP LOCKED`, lease recovery, AbortSignal)
  - `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts` (Tạo mới: Tests tiêu thụ lũy thừa & interleaving race tests)
- **Không sửa đổi chéo (Cross-Editing Prohibited):**
  - Tuyệt đối không chỉnh sửa `packages/tool-schemas/` (do AI/Schema Engineer sở hữu). Đề xuất hợp đồng bổ sung cho schema owner thay vì tự sửa.
  - Tuyệt đối không chỉnh sửa `packages/tool-adapters/` (do Adapter Engineer sở hữu).
  - Tuyệt đối không chỉnh sửa `packages/planner/` hay `prompts/` (do AI Engineer sở hữu).
  - Tuyệt đối không chỉnh sửa `apps/chat-web/` (do Frontend Engineer sở hữu).

---

## 3. Điều Tra Thực Tế: 7 Nhóm Bản Sao Dữ Liệu Nguồn & Trách Nhiệm Tiêu Thụ

Đối chiếu trực tiếp mã nguồn và cơ sở dữ liệu hiện hữu (`db/v3/0001_v3_core.sql`, `0010_schedules.sql`, `chat-service.ts`), hệ thống nhận diện chính xác 7 nhóm mục tiêu (Target Kinds) chứa dữ liệu nguồn hoặc bản sao phái sinh theo đúng 7 literal chuẩn tắc từ `SLACK_DERIVED_TARGET_KINDS`:

| Nhóm mục tiêu (`SlackDerivedTargetKind`) | Vị trí lưu trữ hiện hữu trong DB / Bộ nhớ | Bản chất dữ liệu nguồn lưu giữ | Trách nhiệm của bên tiêu thụ (Consumer Obligations) | Bên sở hữu module |
|---|---|---|---|---|
| **1. `chat_history_message`** | Bảng `messages` (`role IN ('user', 'assistant', 'system', 'summary')`, cột `content`, `metadata`) | Trích đoạn tin nhắn, danh sách kênh, kết quả tra cứu Slack được hiển thị cho người dùng | Lưu giữ `sourceRefs` và `policyRef` trong `metadata`. Khi nguồn bị tombstone/purge, consumer phải ẩn/redact toàn bộ khối nội dung không thể bóc tách an toàn | Backend (`apps/chat-api`) |
| **2. `working_memory_entity`** | Bảng `messages` với `metadata->>'type' = 'working_memory'`, cột `metadata->'state'` | Trạng thái bộ nhớ làm việc qua các lượt hội thoại (chứa `__observed` IDs, thread participants, nhãn tin nhắn) | Ghi nhận provenance nguồn vào cấu trúc state. Khi nguồn bị thu hồi, bộ lọc memory của planner phải loại bỏ entity khỏi prompt | AI Planner (`packages/planner`) & Backend |
| **3. `plan_step_arg`** | Bảng `plans` (`plan_json`, `plan_text`) và `execution_steps` (`args_json`, `output_json`) | Tham số các bước thực thi workflow chứa nội dung tin nhắn, ID kênh, dữ liệu Slack | Bắt buộc đối chiếu `sameSlackBinding` và kiểm tra tính hợp lệ của nguồn trước khi dispatch; đánh dấu `skipped`/`purged` nếu nguồn bị vô hiệu | Backend & Executor (`packages/executor`) |
| **4. `proposal_excerpt`** | *Chưa có bảng vật lý* (Kế hoạch SLACK-06A tại `slack_proposals`) | Đề xuất hành động chờ người dùng duyệt trong cockpit | Không viết SQL purge giả tạo cho bảng chưa tồn tại; đặc tả nghĩa vụ schema tương lai: mọi proposal phải mang `sourceRefs` và bị hủy tự động (`auto_dismissed_source_revoked`) nếu nguồn bị tombstone | Backend & Frontend (SLACK-06) |
| **5. `daily_digest_entry`** | *Chưa có bảng vật lý* (Kế hoạch SLACK-06C tại `slack_digests` / cache) | Bản tin tóm tắt tổng hợp từ nhiều kênh/tin nhắn Slack | Ghi nhận danh sách `sourceRefs` cấu thành; khi 1 nguồn thành phần bị purge do vi phạm chính quyền/consent, toàn bộ digest liên quan phải bị ẩn hoặc tái lập | Backend & AI Planner (SLACK-06) |
| **6. `scheduled_workflow_arg`** | Bảng `schedules` (`request`, `recurrence`, `services`) và `schedule_runs` (`plan_id`, `status`) | Yêu cầu định kỳ có thể trích dẫn nội dung Slack hoặc phụ thuộc kênh Slack | Khi mất quyền kênh (`channel_membership_lost`) hoặc ngắt kết nối, schedule chuyển `paused` kèm `pause_reason = 'slack_binding_invalid'` | Backend (`apps/chat-api/src/services/schedules/`) |
| **7. `audit_log_entry`** | Bảng `execution_steps` (`error_json`, `duration_ms`), audit logs | Nhật ký kiểm toán kỹ thuật và đối soát bảo mật | Nhật ký kiểm toán chỉ lưu metadata an toàn (IDs, timestamp, status), tuyệt đối không lưu nội dung thô PII | Backend (`apps/chat-api`) |

### 3.1. Ranh giới Phân đoạn Provenance (Provenance Segment Boundary):
- **Phân đoạn Đơn lẻ vs Bằng chứng Đầy đủ:** Khái niệm `DerivedCopyRef` chỉ đại diện cho **MỘT** phân đoạn ủy quyền với full-binding cụ thể (1 user, 1 connection, 1 workspace, 1 Slack actor, 1 identityVersion).
- **Trách nhiệm Tổng hợp Phân đoạn ở SLACK-03B2+:** Đối với các mục tiêu phái sinh trải rộng trên nhiều workspace hoặc tổng hợp từ nhiều nguồn dữ liệu khác nhau (ví dụ: bản tin Daily Digest gom tin từ Workspace A và Workspace B, hoặc kế hoạch workflow cross-workspace), bên tiêu thụ 03B2 bắt buộc phải **tổng hợp TOÀN BỘ các phân đoạn ủy quyền tương ứng (aggregate ALL segments)** (`authorizationSegments: DerivedCopyRef[]`).
- **Tái thẩm định Mọi Phụ thuộc (Revalidate Every Dependency):** Trước khi hiển thị trên giao diện hoặc đưa vào prompt cho model, consumer phải tái thẩm định tính hợp lệ của từng phân đoạn thành phần qua `SlackPolicyService`. Tuyệt đối không coi một phân đoạn đơn lẻ là bằng chứng provenance hoàn chỉnh cho toàn bộ artifact phái sinh phức hợp. Nếu bất kỳ phân đoạn nào bị thu hồi hoặc tombstone, toàn bộ khối nội dung không thể bóc tách an toàn phải bị ẩn hoặc loại bỏ.

---

## 4. Thiết Kế Kỹ Thuật Chi Tiết (SLACK-03B1)

### 4.1. Mô hình Tham chiếu Chính sách 8 Trường & Phân Tách Mục Đích Lưu Trữ
- Bản ghi nguồn lưu giữ bộ tham chiếu chính sách chuẩn tắc 8 trường (`SlackPolicyReference`):
  1. `binding`: `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`).
  2. `purpose`: Chuẩn hóa cố định là `'storage'` cho tham chiếu lưu trữ bất biến.
  3. `requestedRetentionDays`: Số nguyên an toàn dương (`> 0` và `<= 7`), lưu trong cột riêng `requested_retention_days`. Không dùng trường legacy `retentionDays` làm canonical field.
  4. `providerProfileId`: Khớp định danh provider runtime từ cấu hình server.
  5. `configFingerprint`: Vân tay cấu hình provider runtime.
  6. `policyVersion`: Chuỗi phiên bản chính sách tổ chức được chấp thuận.
  7. `consentRevision`: Chuỗi thập phân dương chuẩn tắc (`/^[1-9][0-9]*$/`).
  8. `providerRevision`: Chuỗi thập phân dương chuẩn tắc (`/^[1-9][0-9]*$/`).
- **Nguyên tắc phân tách mục đích (Purpose Separation):** Tham chiếu lưu trữ `'storage'` là bất biến, đại diện cho bằng chứng thẩm định tại thời điểm thu thập dữ liệu vào DB. Khi một consumer (như `manual_lookup`, `triage`, `planning`, `digest`) đọc nguồn ra để sử dụng, consumer phải tự thực hiện một ủy quyền riêng biệt qua `SlackPolicyService.resolveSlackModelPolicy` với `purpose` của chính mình. Tuyệt đối không dán nhãn lại (relabel) purpose của bản ghi lưu trữ hoặc gán dữ liệu cũ vào ủy quyền mới.

### 4.2. Khóa Dòng Tuần Tự Hóa & Cổng Ghi Nguyên Tử (Atomic Database ACL & Lock Ordering)
- **Vấn đề MVCC:** Dưới mức cô lập mặc định Read Committed của PostgreSQL, câu lệnh `INSERT ... SELECT ... WHERE` đơn thuần chụp snapshot tại thời điểm bắt đầu câu lệnh; nếu giao dịch `revokeConsent` diễn ra song song và chưa commit, câu lệnh INSERT vẫn nhìn thấy `status = 'granted'` và commit sau đó, dẫn tới lọt nguồn stale.
- **Thứ tự Khóa Tường minh (Lock Ordering):**
  1. Khóa kết nối: `SELECT id, user_id, workspace_id, actor_id, identity_version, status FROM slack_connections WHERE id = $connectionId AND user_id = $atiUserId FOR SHARE`.
  2. Khóa sự chấp thuận: `SELECT workspace_id, provider_id, status, policy_version, revision, purposes, retention_days FROM slack_processing_consents WHERE workspace_id = $workspaceId AND provider_id = $providerProfileId FOR SHARE`.
  - *Tương thích tuyệt đối với 02B:* `SlackConsentRepo.revokeConsent` sử dụng `SELECT ... FOR UPDATE` trên `slack_processing_consents`. Do đó, nếu revoke đang chạy, INSERT sẽ phải chờ revoke commit; khi revoke commit xong, INSERT đọc thấy `status = 'revoked'` và bị từ chối ngay. Ngược lại, nếu INSERT giữ khóa `FOR SHARE` trước, revoke sẽ phải chờ INSERT commit; khi INSERT commit xong, revoke chạy tiếp và tạo ngay sự kiện/rào chắn vô hiệu hóa nguồn vừa tạo.
- **Cổng Thẩm Định Toàn Diện (Authoritative Gate):**
  - Đầy đủ 5 trường binding: `atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`.
  - Kết nối active, người dùng active.
  - Consent status = `'granted'`, `policy_version = $policyVersion`, `revision = $consentRevision`.
  - Quyền mục đích lưu trữ: `'storage' = ANY(spc.purposes)`.
  - Giới hạn retention: `requested_retention_days <= spc.retention_days AND requested_retention_days <= stp.max_retention_days AND requested_retention_days <= 7`.
  - Provider verified = true, no_training = true, `configuration_fingerprint = $configFingerprint`, `revision = $providerRevision`.
- Khóa nguồn phức hợp duy nhất cho từng chủ sở hữu (`owner_source_key`): định dạng tuple JSON chuẩn tắc từ hàm `formatSlackOwnerSourceKey(ref: SlackSourceRef)` (nhận 1 tham số duy nhất). Hai người dùng ATI khác nhau cùng workspace kết nối cùng 1 message Slack có 2 row độc lập, cách ly tuyệt đối.

### 4.3. Quy Định Trần Thời Gian Lưu Trữ Kho Nguồn Thô (Raw-Only TTL Enforced by Server)
- Áp đặt trần cứng cho **TẤT CẢ** các loại tài nguyên thô: Tối đa **7 ngày** (`MAX_RAW_BODY_RETENTION_DAYS = 7`).
  `CONSTRAINT chk_slack_sources_raw_retention CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '7 days')`
  `CONSTRAINT chk_slack_sources_retention_days CHECK (retention_days > 0 AND retention_days <= 7)`
- Loại bỏ hoàn toàn đường dẫn `isExcerpt` và trần 30 ngày khỏi bảng nguồn thô 03B1 (trích đoạn 30 ngày thuộc 03B2).
- Server tự tính `expires_at = captured_at + (retention_days || ' days')::interval`; client gửi `expiresAt` tự chế sẽ bị bỏ qua hoàn toàn.
- Trường hợp chính sách hoặc nhà cung cấp quy định retention là 0: Cho phép xử lý trong bộ nhớ tức thời (in-memory processing), **NGHIÊM CẤM LƯU TRỮ BỀN VỮNG** (`retention_zero_denied`).
- **Chống làm mới TTL tùy tiện (No Idempotent Upsert TTL Renewal):** Bản ghi đã tombstoned hoặc purged tuyệt đối không được nhận plaintext mới qua upsert. Khi refetch dữ liệu hợp lệ mới, tạo một capture revision mới độc lập thay vì ghi đè làm hỏng provenance lịch sử.

### 4.4. Cơ Chế Đọc Nguồn An Toàn `getSource` & Rào Chắn Đọc Tức Thì
- Khi consumer gọi `getSource`:
  1. Yêu cầu đầy đủ 5 trường binding, định danh capture/revision chính xác, và mục đích tiêu thụ riêng biệt (`purpose: 'manual_lookup' | 'triage' | 'planning' | 'digest'`). Tuyệt đối không chọn "latest resource" để bind mù vào artifact cũ.
  2. Tra cứu bảng rào chắn vô hiệu hóa bền vững `slack_invalidation_barriers`: Nếu tồn tại rào chắn active (ví dụ: disconnect đang chờ purge, revoke barrier), đọc bị CHẶN NGAY LẬP TỨC (`status: 'blocked_by_invalidation_barrier'`) trước khi worker purge vật lý chạy.
  3. Tái thẩm định trực tiếp với `SlackPolicyService.resolveSlackModelPolicy`: Kiểm tra kết nối active, consent granted, provider verified, revisions khớp, và purpose được cho phép. Nếu vi phạm, trả về `{ status: 'blocked_by_policy_change', safeMetadataOnly }`.
  4. Nếu bản ghi đã tombstoned hoặc hết hạn: Chỉ trả về siêu dữ liệu an toàn (`safeMetadataOnly`), tuyệt đối không để lộ `untrusted_content`.

### 4.5. Hàng Đợi Ý Định Vô Hiệu Hóa & Giao Diện Liên Kết Giao Dịch (04A Ingress & Disconnect)
- Bảng `slack_invalidation_intents` lưu vết mọi yêu cầu vô hiệu hóa dữ liệu.
- Bảng `slack_invalidation_barriers` lưu các rào chắn tức thì:
  `(id, barrier_type, workspace_id, connection_id, channel_id, resource_type, resource_id, before_consent_revision, before_provider_revision, created_at, active)`.
- **Giao diện liên kết giao dịch (Transaction-Bound Invalidation Interface):**
  Hàm chuẩn tắc: `commitLifecycleInvalidation(client: pg.PoolClient, intent: SlackPurgeTarget, barrier?: InvalidationBarrier): Promise<void>`.
  - *Với 04A Ingress:* Nhận webhook ký số (`tokens_revoked`, `message_deleted`, v.v.), mở transaction DB, ghi receipt + gọi `commitLifecycleInvalidation` để commit barrier và intent, rồi mới gửi HTTP 200 ACK cho Slack.
  - *Với Disconnect:* Trong `SlackConnectionRepo.disconnect`, mở transaction, lock và bắt (capture) binding CŨ, gọi `commitLifecycleInvalidation` cho binding cũ, cập nhật trạng thái disconnected, tăng identity_version, rồi mới commit và gọi best-effort `auth.revoke`.
- Worker dọn dẹp xử lý intent với `SELECT ... FOR UPDATE SKIP LOCKED`, lease timeout 60s, retry tối đa 5 lần và tự phục hồi khi crash. Worker chạy độc lập với cờ automation (F4 Invariant).

### 4.6. Tiêu Thụ Sự Kiện Chính Sách Lũy Thừa & Mở Rộng Rào Chắn Epoch (Review Points 5 & 6)
- **Tiêu thụ lũy thừa (Idempotent Consumption):** Bảng `slack_invalidation_intents` có cột `policy_event_id UUID UNIQUE REFERENCES slack_policy_events(id)`. Bộ quét sự kiện sử dụng truy vấn:
  `SELECT ev.* FROM slack_policy_events ev WHERE NOT EXISTS (SELECT 1 FROM slack_invalidation_intents WHERE policy_event_id = ev.id) ORDER BY ev.occurred_at ASC, ev.id ASC LIMIT $batchSize`.
  Cam kết không đọc trùng lặp, không starvation, không gap con trỏ.
- **Xử lý 4 loại sự kiện 02B:**
  1. `consent_revoked`: Ghi nhận rào chắn `before_consent_revision = event.consent_revision`. Mở rộng thành các mục tiêu thu hồi chính xác cho các revision cũ (`exactConsentRevision = String(oldRevision)`), đồng thời chặn đọc mọi revision `< event.consent_revision`. Bảo toàn nguyên vẹn các revision mới `>= event.consent_revision` (ví dụ Grant 1 -> Revoke 2 -> Regrant 3: 1 bị xóa, 3 sống sót).
  2. `consent_granted` (thay đổi retention/purposes): Quét các nguồn có retention hoặc purpose không còn nằm trong danh mục mới và tạo intent vô hiệu hóa.
  3. `provider_attested`: Ghi nhận trạng thái provider sẵn sàng.
  4. `provider_updated`: Khi provider thay đổi fingerprint hoặc revision: nguồn cũ trở nên không thể tiêu thụ ngay lập tức qua revalidation live.
- **Đề xuất Hợp Đồng Mới Cho Schema Owner (Review Point 6):**
  Vì 5 tag hiện tại của 03A không có tag cho việc thay đổi cấu hình/revision của provider, Backend Planning Owner chính thức đề xuất bổ sung tag thứ 6 vào `@wap/tool-schemas`:
  ```ts
  export interface SlackProviderProfilePurgeTarget {
    scope: 'provider_profile_revocation';
    workspaceId: string;
    providerProfileId: string;
    providerRevision: string;
    cascadeTargetKinds: SlackDerivedTargetKind[];
    tombstoneReason: 'policy_changed' | 'provider_unverified';
  }
  ```
  Trong 03B1 nội bộ, lý do tombstone được ghi nhận chính xác là `'policy_changed'` hoặc `'provider_unverified'`, tuyệt đối không ghi nhận sai lệch thành `'source_deleted'`.

---

## 5. Danh Mục File Thi Công & Test Dự Kiến

### 5.1. File Mã Nguồn (Backend Owner):
1. `db/v3/[proposed: NNNN_slack_source_store.sql]`:
   - Bảng `slack_sources` (raw-only `<= 7 ngày`, 8 trường canonical policy evidence, khóa duy nhất `owner_source_key`).
   - Bảng `slack_invalidation_barriers` (chặn đọc tức thì trước purge).
   - Bảng `slack_invalidation_intents` (hàng đợi phân phối `SKIP LOCKED`, liên kết `policy_event_id` idempotent).
2. `apps/chat-api/src/db/repositories/slack-source-repo.ts`:
   - Lớp repository: `saveSourceAtomic` (khóa dòng `FOR SHARE`, thẩm định toàn diện), `getSourceWithAcl`, `tombstoneByOwnerKey`, `markPurged`, `listExpiredActiveSources`.
3. `apps/chat-api/src/services/slack/slack-source-store.ts`:
   - Dịch vụ nguồn thô: áp trần TTL 7 ngày máy chủ, gọi `formatSlackOwnerSourceKey(ref)`, cơ chế đọc an toàn `getSource` kết hợp barrier guard và live policy revalidation.
4. `apps/chat-api/src/services/slack/slack-invalidation-service.ts`:
   - Quản lý hàng đợi và rào chắn vô hiệu hóa: `commitLifecycleInvalidation`, `claimBatch` (`FOR UPDATE SKIP LOCKED`), `executeTombstone`, `completeIntent`, `failIntent`.
5. `apps/chat-api/src/services/slack/slack-invalidation-runner.ts`:
   - Tiến trình nền tự động quét nguồn hết hạn TTL và thực thi intent dọn dẹp, chạy độc lập với cờ automation.
6. `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts`:
   - Tiêu thụ sự kiện chính sách lũy thừa, mở rộng rào chắn epoch cho cả 4 loại sự kiện 02B.
7. `apps/chat-api/src/db/repositories/slack-connection-repo.ts`:
   - Bắt binding CŨ trong transaction disconnect và gọi `commitLifecycleInvalidation`.
8. `apps/chat-api/src/app.ts`:
   - Đăng ký khởi động `SlackInvalidationRunner` độc lập với cấu hình tính năng.

### 5.2. File Kiểm Thử Tích Hợp (Real PostgreSQL 16 Fixtures):
1. `apps/chat-api/tests/db/slack-source-repo.test.ts`:
   - Test 1: Khóa dòng tuần tự hóa: Client 1 `saveSourceAtomic` (`FOR SHARE`) và Client 2 `revokeConsent` (`FOR UPDATE`) chạy xen kẽ; chứng minh không bao giờ để lọt nguồn stale hoặc late insert sau revoke.
   - Test 2: Cổng thẩm định từ chối khi purpose thiếu `'storage'`, hoặc retention > 7 ngày, hoặc revisions không khớp.
   - Test 3: Cách ly 2 user cùng workspace qua `owner_source_key`.
2. `apps/chat-api/tests/services/slack/slack-source-store.test.ts`:
   - Test 1: Áp trần 7 ngày cho mọi loại tài nguyên thô; client gửi retention > 7 bị ép về 7.
   - Test 2: Từ chối lưu trữ khi consent retention = 0 (`retention_zero_denied`).
   - Test 3: `getSource` chặn đọc ngay khi có active barrier trong `slack_invalidation_barriers` trước khi purge chạy.
   - Test 4: `getSource` chặn đọc khi consent hoặc provider bị thay đổi live trong DB.
3. `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`:
   - Test 1: Concurrency `SKIP LOCKED`: 2 worker claim song song không trùng lặp.
   - Test 2: Crash recovery: intent hết hạn lease được claim lại an toàn.
   - Test 3: Hủy tiến trình với `AbortSignal` không làm hỏng trạng thái DB.
4. `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`:
   - Test 1: Tiêu thụ lũy thừa: chạy `consumePendingPolicyEvents` nhiều lần không sinh intent trùng lặp.
   - Test 2: Barrier epoch mapping: Grant 1 -> Revoke 2 -> Regrant 3; chứng minh nguồn 1 bị xóa, nguồn 3 tồn tại nguyên vẹn.

---

## 6. Kế Hoạch Chạy Kiểm Thử TDD (RED → GREEN)

```bash
# 1. Chạy suite kiểm thử repository DB (Kỳ vọng RED khi chưa có code)
npm test -w @wap/chat-api -- tests/db/slack-source-repo.test.ts

# 2. Chạy suite kiểm thử dịch vụ lưu trữ nguồn
npm test -w @wap/chat-api -- tests/services/slack/slack-source-store.test.ts

# 3. Chạy suite kiểm thử dịch vụ hàng đợi vô hiệu hóa & rào chắn
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

- [ ] Bảng `slack_sources` là raw-only với ràng buộc cứng `<= 7 ngày` cho toàn bộ tài nguyên, chứa đủ 8 trường canonical policy evidence (gồm cột `requested_retention_days`).
- [ ] Ghi nguồn vào DB thực hiện qua khóa dòng tuần tự hóa (`FOR SHARE` trên connection và consent), loại trừ race window với `revokeConsent` (`FOR UPDATE`) của 02B dưới PostgreSQL MVCC.
- [ ] Hàm `getSource` thẩm định đầy đủ 5 trường binding, kiểm tra rào chắn tức thì `slack_invalidation_barriers` và revalidate trạng thái live DB trước khi trả về dữ liệu; không cho phép silent rebinding.
- [ ] Tiêu thụ sự kiện chính sách `consumePendingPolicyEvents` bảo đảm tính lũy thừa qua `policy_event_id`, xử lý đủ 4 loại sự kiện 02B.
- [ ] Barrier epoch mapping xử lý đúng kịch bản Grant 1 -> Revoke 2 -> Regrant 3; có đề xuất bổ sung tag `provider_profile_revocation` cho Schema Owner.
- [ ] Giao diện vô hiệu hóa liên kết giao dịch `commitLifecycleInvalidation` được thiết lập cho 04A webhook ingress và disconnect (bắt binding cũ).
- [ ] Tiến trình dọn dẹp chạy độc lập với cờ tự động (`MYSLACK_AUTOMATION_ENABLED`).
- [ ] Toàn bộ 7 nhóm bản sao phái sinh được ghi nhận bằng đúng literal chuẩn tắc, tuân thủ nguyên tắc tổng hợp đa phân đoạn provenance (multi-segment aggregation) cho 03B2+.
- [ ] Không có thay đổi nào xâm phạm mã nguồn ngoài package Backend (`apps/chat-api/`, `db/v3/`).

---

## 8. Kết Quả Thực Thi (Execution Results)

*(Phần này sẽ được agent thi công điền sau khi hoàn tất triển khai mã nguồn và thu thập đầy đủ bằng chứng kiểm thử thực tế).*
