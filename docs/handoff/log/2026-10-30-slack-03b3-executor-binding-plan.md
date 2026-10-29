# 30/10/2026 · Hiệu chỉnh kế hoạch binding executor & phê duyệt Slack (SLACK-03B3)

**Nhánh:** `docs/slack-03b3-executor-binding-plan` · **Nền tham chiếu:** integration `612ac427` (`origin/integration/slack-personal-20261029`; 03C1 `390b1c54` và 03B1 `23544be9` đã review/merge) · **PR:** #201, head trước hiệu chỉnh `7c958d4c` · **Trạng thái:** PLAN_ONLY, chờ review lại.

## Vì sao hiệu chỉnh

Review độc lập bản `7c958d4c` chỉ ra sáu khe hở thiết kế: guard chỉ nhận digest; quét args thô bỏ sót binding qua `$ref`/`$template` và `sourceRefs` coi mọi output là Slack cùng binding; TOCTOU giữa authorize và `getAdapter`/transport; Task 1 chỉ có TS interface nhưng đề xuất test runtime GREEN; cấm nhầm mọi multi-workspace; anchor 03B1/03C1 còn ghi "chưa merge". Phiên này sửa đúng 3 tài liệu 03B3, không sửa mã.

## Đã sửa

1. **Envelope đầy đủ thay digest:** `SlackDispatchEnvelope` gồm binding, tool, params đã phân giải, `sources` (selector, sourceRef, `origin`, provenance per-entity, `captureId` khi stored, `acquisitionPolicyReference`, `policyEpoch`), policy ref, digest. Guard nhận **cùng object envelope đã freeze** sẽ dispatch, không chỉ hash; digest chỉ ràng buộc.
2. **Resolver grammar + dependency server-derived:** `$ref` đúng `stepId.path`, `$template` chỉ token `${stepId.path}`, không khóa phụ, phân giải một lượt. Server dẫn xuất **đầy đủ** selector từ args thô, lưu vào `dependencies`, so bằng đúng khi execute; model không cung cấp danh sách. Params resolved được quét `binding` sâu + validate canonical đệ quy; provenance buộc đúng entity/path, mọi segment của output hỗn hợp; non-Slack chỉ làm param canonical, không làm binding. Thêm test synthetic substitution/tamper/origin vào ma trận (19–25, 29).
3. **TOCTOU:** detach/deep-freeze `{id,tool,args}` + output được tham chiếu ngay tại entry; resolve một lần; hash + authorize + dispatch cùng envelope; abort recheck sau **mọi** await gồm `getAdapter`; factory await vượt ranh giới quyền phải `authorize` lần cuối; deadline abort settle dù hook/factory treo; lỗi cố định theo code, không echo message hook; deny/abort không lấy adapter/token; không tạo `UNKNOWN` trước transport.
4. **Task 1 runtime validator:** `validateSlackPlanBindings(value, planSteps)` + `deriveSlackDependencySelectors`, từ chối khóa lạ/step thiếu-thừa/connection lạ/policy lệch/dependencies forged; lệnh đúng `npm test -w @wap/tool-schemas -- tests/...` (bỏ `npm run test:v3 -- workspace`). Phân biệt status thật `active/reconnect_required/disconnected`; regrant đổi `consentRevision`, reconnect/reinstall đổi `identityVersion`.
5. **Multi-workspace:** cho phép nhiều assignment rõ ràng `stepId → connectionId`; mỗi bước đúng một assignment; thiếu/trùng/mơ hồ ⇒ từ chối; UI selection 03B4 chưa có ⇒ fail closed, không tuyên bố native.
6. **Anchor:** đọc tại integration `612ac427`; 03C1 `390b1c54` và 03B1 `23544be9` là anchor đã review/merge; 03B2 chỉ PLAN; 03B4/04C chưa có; 04A dùng `apps/db` nhưng tài liệu không chạm runtime.
7. **Digest không tự tham chiếu:** `slackDigestInput(envelope)` là projection đóng bỏ `digest`; `computeSlackExecutionDigest(input)` chỉ băm projection; guard và Backend dùng cùng hàm, nên đổi `envelope.digest` không đổi giá trị tính lại.
8. **Lineage nguồn:** phân biệt `transient` (output cùng lượt), `stored` (raw capture UUID qua `SlackSourceStore.getSource`, sourceRef khớp, content lấy từ entity), `persisted` (output_json/resume/derived). Provenance 03C1 không làm persisted thành transient; persisted/derived bị deny tới 03B2. `SlackSourceProvenance` đặt tại `tool-schemas/src/myslack-source.ts` sau đồng ý Schema + Backend + 03C1; executor không import `tool-adapters` để lấy type.

## Căn cứ mã đã đọc tại `612ac427`

- `packages/executor/src/{runner,resolver,controller,types}.ts`: `resolveArgs` trước `await getAdapter`, không detach/abort-recheck; resolver grammar thực tế (chấm đầu tiên, object ref có khóa phụ vẫn được coi là ref, một lượt).
- `packages/tool-schemas/src/{types,myslack-context,myslack-tools,myslack-policy,myslack-source}.ts`: `PlanConnections` chỉ gmail/mycalendar/mysheets; `validateSlackToolExecutionArgs` canonical đệ quy; policy ref 8 trường; `SlackSourceLineage` contract có sẵn nhưng runtime lineage 03B2 chưa có.
- `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` + `personal-slack-types.ts`: 8 read, provenance per-entity, `nativeRevision` chỉ khi Slack trả.
- `apps/chat-api/src/services/slack/{slack-invalidation-service,policy-service,token-manager,slack-source-store}.ts`, `db/repositories/{slack-connection-repo,plan-repo}.ts`, `services/{chat-service,execution-service,execution-recovery}.ts`: `checkBarriers` chỉ match đủ trường khi có `channelId`/`resourceType`+`resourceId`+`revision`/`epoch`; `getSource` đòi `expectedCaptureId` hoặc `expectedPolicyEpoch` + `consumerPurpose`; `withOwner`+`get` (không có `getConnectionMetadataForUser`); status thật; CAS `approvePlan`; recovery đọc `output_json` vào `initialStates`.

## Kiểm chứng đã chạy thật

- Kiểm tra liên kết nội bộ bằng Node (resolve tương đối từ thư mục chứa file, bỏ qua http/`#`/absolute): `checked=5 missing=0`.
- UTF-8: cả 3 file giải mã bằng `TextDecoder('utf-8', {fatal:true})` không lỗi, không có ký tự thay thế: `utf8_ok=3`.
- Số dòng kế hoạch: `wc -l` = 300 (≤ 300).
- `git diff --check` trên đúng 3 file đã stage: sạch (exit 0).

## Chưa làm / không tuyên bố

- Không chạy bất kỳ test runtime nào (`NOT_RUN` toàn bộ) vì task chỉ sửa tài liệu; không có "all tests passed".
- Chưa nghiệm thu 03B4 (wrapper token/policy + routing/UI), 03B2 (lineage F3), 04C (outbox/UNKNOWN/write), native Slack API; F2/F3 giữ `NOT_RUN`. Đường `stored`/`captureId` chỉ là đề xuất vì 03C1/03B4 chưa phát capture ID.
- Không cập nhật `CURRENT-STATE.md`/`ROADMAP.md`; reviewer làm sau khi merge.
- PR #201 được cập nhật mô tả sau commit hiệu chỉnh; không merge trong phiên.
