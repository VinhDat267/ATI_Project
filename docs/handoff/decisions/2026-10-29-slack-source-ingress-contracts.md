# SLACK-03/04: giao diện kho nguồn, adapter đọc và ingress

Quyết định kỹ thuật ngày 29/10/2026, trong phạm vi đặc tả Slack đã duyệt. Đây là giao ước giữa owners trước khi thi công, chưa phải nghiệm thu runtime hoặc F3.

Nền tích hợp `f67c0b166219b93b9e336866997bfdd4c703d062` đã có SLACK-02 và schema SLACK-03A [#194](https://github.com/VinhDat267/ATI_Project/pull/194), head `bc8d6b69`. Backend/Integration triển khai [kế hoạch nguồn #196](https://github.com/VinhDat267/ATI_Project/pull/196) và [kế hoạch đọc #197](https://github.com/VinhDat267/ATI_Project/pull/197); ingress theo [#195](https://github.com/VinhDat267/ATI_Project/pull/195). Các chữ ký cũ khác với quyết định này phải được cập nhật trong PR thi công tương ứng.

## Policy epoch và provenance

`SlackPolicyEpoch` gồm `binding`, `providerProfileId`, `configFingerprint`, `policyVersion`, `consentRevision`, `providerRevision`. Binding giữ đủ ATI user, connection, workspace, Slack user, identityVersion. Hai revision là chuỗi số nguyên thập phân chuẩn, không ép sang Number.

Scope `policy_epoch_invalidated` chọn đúng epoch cũ và dùng reason `policy_changed`. Purpose và requestedRetentionDays thuộc canonical policy reference đầy đủ, không thuộc epoch. Epoch là định danh bằng chứng; nó không tự cấp quyền.

Mỗi observation của adapter giữ resource identity và canonical `acquisitionPolicyReference`. Kho nguồn xin quyền storage riêng, so khớp epoch giữa acquisition và storage; dữ liệu lấy dưới grant cũ không được bọc bằng quyền của lần regrant mới. Capture UUID khác với resource/revision; recapture hợp lệ không ghi đè capture cũ hoặc tự tạo native Slack revision.

Schema Owner và Backend đã chấp nhận scope này. Schema #194 được reviewer chạy 19 ca độc lập, 266 package tests và exact-head CI; việc đó không chứng minh consumer runtime.

## Hooks đọc nội bộ

```ts
type SlackReadPurpose = Exclude<SlackPolicyPurpose, 'storage'>;
getAccessToken(binding: SlackBinding): Promise<string>;
authorizeRead(input: {
  binding: SlackBinding;
  purpose: SlackReadPurpose;
  requestedRetentionDays: 0;
  expectedPolicyReference?: SlackPolicyReference;
}): Promise<
  | { allowed: true; policyReference: SlackPolicyReference }
  | { allowed: false; reason: string }
>;
```

Backend xác nhận giao diện qua `msg_150cb7b10000`; coordinator chấp nhận và chuyển cho Integration qua `msg_f333d274f71e`.

Token chỉ đi qua wrapper tin cậy và bộ nhớ transport. Wrapper Backend riêng phải kiểm tra đủ binding, active user/connection, policy hiện hành và pending lifecycle/source barriers. Nó chuyển đổi các service 02B hiện có; signature trên không khẳng định TokenManager hiện có nhận full binding hoặc AbortSignal.

Adapter giữ ref ban đầu, kiểm tra cấu trúc và so khớp lại trước mỗi request/retry và sau response/body await. Không nhận ref thiếu trường, boolean-only decision hoặc âm thầm thay ref khi regrant. Kết quả retention0 là transient; lưu nguồn/derived copy cần quyền storage riêng. Wrapper Backend và kiểm thử PostgreSQL ghép vẫn là hạng mục nghiệm thu riêng.

## Staging barrier trong transaction

```ts
stageInTransaction(client: PoolClient, input: {
  sourceEventKey: string;
  effects: Array<{
    effectKey: string;
    barrier: SlackInvalidationBarrier; // kiểu union do Backend sở hữu
    purgeTarget?: SlackPurgeTarget;
  }>;
}): Promise<{
  receiptId: string;
  barrierIds: string[];
  intentIds: string[];
}>;
```

Backend đề xuất qua `msg_150cb7b10000`; owner ingress chấp nhận qua `msg_f8496036c7ba`; coordinator xác nhận cho Backend. Tên method thống nhất là `stageInTransaction`.

- Caller giữ transaction PostgreSQL thật; helper không tự commit. Receipt, effects, read barriers và purge intents phải nguyên tử trước ACK.
- Event key là tuple có namespace, gồm app/native event hoặc policy event. Receipt UNIQUE event key và effect UNIQUE(event key, effect key) đều non-null. Một event có nhiều effects; duplicate không gắn lại với connection generation mới.
- Kiểu barrier phải phân biệt binding/channel đầy đủ 5 trường, exact policy epoch, global resource key có workspace/channel/resource, và provisional authorization validation. Không dùng một bag có connectionId tùy chọn thiếu identityVersion để giả định generation fencing.
- Edit watermark chỉ vô hiệu hóa native revision cũ; delete không bị edit đến muộn làm sống lại. Resource identity phải chống trùng timestamp giữa các channel.
- `purgeTarget` tùy chọn: provisional read block chưa được phép xóa dữ liệu. Pending/failed barrier tiếp tục chặn đọc; xóa raw không được đánh dấu toàn bộ 7 nhóm derived copies đã hoàn tất.

## Sự kiện thu hồi và reinstall

Slack cung cấp user IDs trong `tokens_revoked`, không cung cấp token/grant generation ID. [Tài liệu Slack](https://docs.slack.dev/reference/events/tokens_revoked/). Vì vậy coordinator chọn cách xử lý thận trọng: timestamp là gợi ý thứ tự, không tự chứng minh credential hiện tại bị thu hồi.

Ingress chặn đọc bằng provisional barrier theo binding đã bắt dưới owner lock, giữ encrypted config riêng tư và ghi validation intent cho từng binding trước ACK. Worker sau ACK kiểm tra metadata của credential đã bắt; kết quả chỉ áp dụng khi generation, credential fingerprint và validation ownership còn khớp. Valid credential chỉ gỡ barrier tạm thời tương ứng; invalid được xác nhận mới disconnect/purge đúng generation cũ; timeout/rate-limit vẫn chặn đọc. Disconnect thủ công/reconnect hoặc barrier khác không bị validation cũ ghi đè. Delayed app_uninstalled sau reinstall cần cùng nguyên tắc bảo toàn generation mới.

Lifecycle mutation phải phối hợp owner advisory lock hiện có của TokenManager qua khoảng refresh mạng. Không giả định refresh hiện có đã dùng CAS; mọi thay đổi CAS cần code và kiểm thử thật trong task Backend sở hữu.

## Cổng còn mở

03B1 chỉ xử lý nguồn thô, TTL hữu hiệu tối đa7 ngày. Cascade 7 nhóm derived copies, executor binding, private wrapper/routing, ingress runtime, modes/Inbox và native/model acceptance vẫn mở. Cờ xử lý nội dung chưa được bật. Model dùng để viết code không phải bằng chứng provider được quyền xử lý nội dung Slack.
