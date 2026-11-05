# FLOW-08 · Sửa review PR #277

- Ngày: 2026-11-04 (Asia/Bangkok), task [FLOW-08](../tasks/FLOW-08-pr277-review-fixes.md).
- Nhánh: `fix/flow-review-regressions`; base PR #277 `ff9d24e47f3d8f529fd181330f17073c9b6ef5e6`.
- Plan: [PR #277 remediation](../../superpowers/plans/2026-11-04-pr277-remediation.md).
- Không sửa CURRENT-STATE/ROADMAP, không merge, không thay flags hoặc cấu hình DB ứng dụng.

## Hành vi sau sửa

1. Planner, validator và API dùng cùng chính sách nhận diện báo cáo. API dùng request do server lưu, bám `planId/replyToMessageId`; không dùng summary model để hạ một báo cáo thành thông báo. SQL giữ nguyên microsecond, loại lượt chat đến sau và dừng history tại kết quả đã hoàn tất.
2. Cùng một báo cáo nhiều đích được dựng từ một observation và kiểm hash trên mọi trường text/body/content trước approval CAS. Không tự cấp observation khi thiếu server store.
3. GitHub renderer đọc canonical `url` của adapter, vẫn tương thích fixture cũ dùng `html_url`.
4. Sheets populated thiếu headers không biến thành zero. Không ép headerAware hay thay range; hỏi lại trước gửi khi chưa biết hàng tiêu đề. Vùng A2 không mất dòng đầu. Header mode đã chỉ định được giữ.
5. Defaults editor đóng, bỏ draft khi đổi user/workspace và kiểm scope lần nữa ngay khi Save. Browser xác nhận không lưu draft Personal sang organization.
6. Suite `live-acceptance.test.ts` đổi tên `current-flow-offline.test.ts`; preflight là opt-in, không tự nạp credential live. FLOW-07 được mở lại. Fixture có header-aware shape và persona báo cáo có read thực qua fixture; đây vẫn là test offline.

Yêu cầu trộn báo cáo với các tin nhắn nguyên văn khác nhau hoặc body công việc riêng được hỏi lại/tách yêu cầu. Đây là lựa chọn có chủ ý để không đoán sai đích hoặc ghi đè nội dung. Thông báo nguyên văn độc lập, tạo/cập nhật issue và tra bảng liên hệ để gửi email vẫn được bảo toàn.

## RED -> GREEN

- Regression ban đầu: native planner/renderers + editor scope: 8 failing tests (sau sửa ID fixture, các failure là hành vi cần sửa); API original-request/multiple-output admission: 3 fail (approval trả 200 thay vì 409).
- Microsecond request/plan: RED 200 -> GREEN 409 bằng PostgreSQL thật.
- Lượt chat khác đến trước preview: RED 200 -> GREEN 409 bằng `replyToMessageId`.
- Báo cáo cũ làm chặn nhầm thông báo mới: RED -> GREEN, thông báo mới duyệt 200.
- Reviewer độc lập tìm thêm quoted-topic, mutation title/body, contact count, literal exclusion, A2 mất dòng và null-step không retry; đã thêm kiểm thử hành vi và sửa.
- Reviewer chạy độc lập ba file schema/planner/web: 34/34 PASS; API report-evidence PostgreSQL: 11/11 PASS; các probe riêng đều đóng, không còn phát hiện P1/P2 cụ thể trong bản sửa.

## Kiểm tra thực tế

Môi trường thử: Node 24, PostgreSQL 16 riêng trên loopback port 56534, schema test ngẫu nhiên; DB thử dùng fsync/synchronous_commit off để chạy SQL nhanh. Không suy rộng thành bằng chứng crash durability hay provider thật.

```text
DATABASE_URL=<dedicated synthetic test DB> VITEST_MAX_WORKERS=2 npm run check
PASS, exit 0
schemas: 574 tests; adapters: 636; planner: 546; executor: 55
chat-api: 255 files / 2471 tests PASS
chat-web: 113 files / 1180 tests PASS
evaluations: 31 files / 500 PASS, 1 intentional preflight SKIP
build + web build security: PASS
launcher + Node fixture/environment/Slack scripts: PASS
```

Sau các bổ sung boundary cuối, chạy lại source cuối:

```text
npm run typecheck:v3
PASS, exit 0
VITEST_MAX_WORKERS=2 npm test -w @wap/tool-schemas -w @wap/planner
schemas: 25 files / 577 PASS
planner: 39 files / 547 PASS
exit 0
```

- Lần full check trước đó có ba regression planner và hai lỗi API (demo contract, FE-02 timeout). Regression đã sửa; full check với worker giới hạn đạt toàn bộ 255 file API, FE-02 cũng qua. Không bỏ test hoặc tăng timeout để che lỗi.
- Native adapter/SQL/HTTP probe: GitHubAdapter loopback đọc đúng PR #41 -> AIPlanner -> PlanRepo/MessageRepo/StepRepo -> approve -> executor; plan completed, đúng hai HTTP POST chứa #41 và URL đúng. Bản generic report không có evidence bị 409, không tăng số POST.
- Browser thật trên sandbox app + DB: đổi Personal -> organization khi editor đang mở bỏ draft; lưu lại đích organization đúng; mobile 375×812 đóng/mở editor khôi phục giá trị scoped, không overflow. Không dùng route mock trong probe này.
- Artifact cục bộ giữ tại `.audit/pr277-fix/`: red/green logs, full-check-final.log, final-source-packages.log, dispatch.mts/json/log, browser.mjs/json/log và PNG. Không commit credential/test password hoặc artifact riêng tư.

## Ranh giới nghiệm thu

- Model/OAuth/provider ghi thật và readback: **NOT_RUN** trong task này.
- Sáu luồng × ba lượt live, 36 runtime oracle và sáu persona qua app/history thật: **OPEN/NOT_RUN**, xem [FLOW-07](../tasks/FLOW-07-live-acceptance.md).
- Giữ riêng operator attestation Google Docs/Drive/Sheets/Meet đã có; không phủ nhận tính năng, không đổi attestation thành chứng nhận mười tám lượt.
- Review độc lập source: đạt; exact commit identity và CI mới ghi ở PR sau khi tạo commit. Không merge khi CI/review chưa đạt.
