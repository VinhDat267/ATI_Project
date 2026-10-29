# 29/10/2026 · SLACK-02B — Khắc phục Phản biện Leader, Bổ sung returnTo & Nghiệm thu Toàn diện Backend

**Tác giả:** Backend Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng/Leader ủy quyền theo các thông điệp `msg_22f053536886`, `msg_46087343456f`, `msg_aefaa16d4c7f` và tài liệu `.superpowers/slack02b-resume/resume-brief.md`.
**Nhánh công việc:** `feat/slack-02b-consent-backend` (base: `integration/slack-personal-20261029`).
**Task card:** [`docs/handoff/tasks/SLACK-02B-oauth-backend.md`](../tasks/SLACK-02B-oauth-backend.md).
**PR:** #192 (Draft PR).

---

## 1. Bối cảnh & Khắc phục Phản biện Độc lập của Leader (Leader Review Regressions)

Harness phản biện độc lập của Leader tại `.superpowers/slack02b-resume/leader-policy-review.mts` ghi nhận 4 điểm lỗi trên commit ban đầu `19e4e39c`. Toàn bộ 4 điểm đã được phân tích và khắc phục triệt để bằng mã nguồn thực tế:

1. **Khớp Model Runtime Mặc định (`fingerprint model matches real provider default`):**
   - Trước: `resolveRuntimeProviderIdentity` mặc định `gemini-2.5-flash` và bịa đặt giá trị mặc định `gpt-4o` cho `openai-compatible`.
   - Sau: Đồng bộ chính xác với `packages/planner/src/providers/gemini-provider.ts` sử dụng `gemini-3.8-flash`, không bịa đặt cấu hình cho `openai-compatible`, bổ sung `accountIdentifier` không chứa bí mật vào SHA-256 fingerprint (`slack-policy-runtime.ts`).
2. **Bắt buộc CAS Revision khi Cập nhật/Thu hồi (`existing consent update requires expected revision`):**
   - Trước: Cho phép update hoặc revoke mà không truyền `expectedRevision`, dẫn tới nguy cơ CLI ghi đè ngầm thay đổi của operator khác.
   - Sau: `attestProvider`, `grantConsent`, và `revokeConsent` trong `slack-consent-repo.ts` bắt buộc `expectedRevision` khi cập nhật hàng hiện hữu; nếu thiếu sẽ ném lỗi `SLACK_CAS_REVISION_REQUIRED`.
3. **Fail-Closed khi Thời hạn Lưu trữ Vượt Trần Provider (`metadata is unready when granted retention exceeds verified provider cap`):**
   - Trước: `checkProcessingReady` chỉ kiểm tra fingerprint và cờ verified của provider, bỏ qua điều kiện `retention_days <= provider.max_retention_days`.
   - Sau: `checkProcessingReady` trong `policy-service.ts` kiểm tra toàn bộ tiêu chí fail-closed: nếu `consent.retention_days > provider.max_retention_days` thì `processingReady` lập tức trả về `false`.
4. **Từ chối PolicyReference Cũ sau Revoke/Regrant (`same policy label cannot reuse reference from before revoke-regrant`):**
   - Trước: `resolveSlackModelPolicy` chỉ đối soát `expectedPolicyVersion` dạng chuỗi, bỏ qua `expectedPolicyReference`.
   - Sau: Bổ sung tham số `expectedPolicyReference` vào `ResolveSlackModelPolicyInput`, đối soát toàn diện `consentRevision`, `providerRevision`, `workspaceId`, `providerId`, `retentionDays`, `purpose`, và `binding`. Nếu consent bị revoke và regrant lại (tăng revision dù giữ nguyên nhãn policyVersion), reference cũ lập tức bị từ chối với `policy_changed`.

---

## 2. Hoàn Thiện Hợp Đồng OAuth returnTo & workspaceHint

1. **Migration Schema:**
   - `db/v3/0016_slack_processing_consents.sql`: Bổ sung cột `return_to text` cho bảng `slack_oauth_states` kèm constraint regex `return_to IS NULL OR return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`, đảm bảo tính idempotent và an toàn khi lặp lại.
2. **Repository OAuth States:**
   - `slack-connection-repo.ts`: Lưu trữ `returnTo` trong `start()`, trả về `returnTo` trong `consume()`.
3. **Route & Client Plumbing:**
   - `oauth-client.ts`: Phương thức `authorizationUrl(state, team?)` hỗ trợ tham số `team` (gợi ý workspace) chuẩn Slack OAuth.
   - `routes/connections/slack.ts`:
     - Kiểm tra `returnTo` thuộc sở hữu của caller qua `conversationOwner` (`CONVERSATION_PATH = /^\/c\/<uuid>$/i`), trả về HTTP 400 `RETURN_TO_INVALID` nếu vi phạm.
     - Chuyển tiếp `workspaceHint` vào `authorizationUrl`.
     - Phản hồi endpoint `/callback` trả về envelope chuẩn `SlackCallbackResult` (`connectionId`, `workspaceId`, `workspaceName`, `slackUserId`, `returnTo`) thỏa mãn validator 02A, đồng thời giữ nguyên các alias tương thích (`id`, `actorId`, `processingStatus`) cho frontend PR #193.
   - `app.ts`: Gắn `conversationOwner: options.convRepo ? async (id) => (await options.convRepo.getConversation(id))?.user_id ?? null : undefined` vào `createSlackConnectionRoutes`.

---

## 3. Bằng chứng Kiểm thử (Verification Evidence)

| Bộ kiểm thử | Kết quả thực tế | Ghi chú |
|---|---|---|
| `.superpowers/slack02b-resume/leader-policy-review.mts` | **4/4 PASS** (EXIT 0) | Vượt qua toàn bộ 4 bài test phản biện độc lập của Leader trên DB 55533 |
| `tests/db/slack-consent-repo.test.ts` | **11/11 PASS** (1.68s) | CAS monotonic revisions, validation, 0 retention, atomic policy event, bắt buộc revision |
| `tests/cli/slack-consent-cli.test.ts` | **6/6 PASS** (4.18s) | Spawn process CLI thật, attest, grant, revoke, flags validation, CAS conflict exit 1 |
| `tests/services/slack-policy-service.test.ts` | **10/10 PASS** (1.87s) | 6 tiêu chí fail-closed, fingerprint mismatch, expectedPolicyReference revalidation, provider retention cap |
| `tests/routes/slack-compatibility.test.ts` | **3/3 PASS** (1.45s) | 02A canonical envelope validation, dynamic `processingReady`, legacy aliases, HTTP mutation rejected with 404 |
| `tests/routes/slack-connections.test.ts` | **8/8 PASS** (2.29s) | Setup OAuth, 2 flow song song, `workspaceHint`, `returnTo` validation và canonical `validateSlackCallbackResult` |
| `tests/db/slack-connection-repo.test.ts` | **8/8 PASS** (3.02s) | 02R callback ordering và isolation |
| `tests/services/slack-token-manager.test.ts` | **4/4 PASS** (2.18s) | Token manager và refresh |
| `npm run test:slack:foundation` | **56 Node + 49 Vitest PASS** (105 tests) | Foundation contract và inventory giữ nguyên 100% |
| `npm run typecheck:v3` | **EXIT 0** | Sạch hoàn toàn lỗi TypeScript trên cả chat-api và chat-web |
| Toàn bộ `apps/chat-api` suite | **105 files PASS, 751 tests PASS** (43.61s) | Tăng từ 747 tests lên 751 tests |
| Fullcheck toàn dự án (`npm run check`) | **EXIT 0**: 2.694 v3 tests + 406 eval + 1 launcher + 66 Node = **3.167 tests PASS** | Đạt 100% chất lượng vận hành |
| Whitespace check (`git diff --check`) | **0 lỗi** | Không có trailing whitespace hay conflict marker |

---

## 4. Nguồn gốc Thực thi & Môi trường (Provenance Details)

- **Thư mục làm việc:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\fix-slack-callback-isolation`.
- **Target DB:** `postgresql://ati_v3:<sanitized>@127.0.0.1:55533/ati_v3` (container `ati-slack-review-184-20261029-postgres-1` trên cổng 55533).
- **Ranh giới sở hữu:** Chỉ sửa đổi mã nguồn trong `apps/chat-api/`, `db/v3/0016_slack_processing_consents.sql`, task card `SLACK-02B-oauth-backend.md` và file log này. Hoàn toàn không sửa đổi frontend `apps/chat-web/`, schema `packages/tool-schemas/`, planner `packages/planner/`, executor `packages/executor/`.
