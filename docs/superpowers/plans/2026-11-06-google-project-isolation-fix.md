# Google Project Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Giữ khả năng ngắt kết nối Google độc lập bằng cách tách project thực tế, chặn cấu hình chia sẻ và không thu hồi nhầm grant cũ khi chuyển client.

**Architecture:** Tiếp tục thiết kế project riêng đã được chốt; người dùng chọn lại hướng này ngày 06/11/2026. Guard dùng cấu hình project và kiểm tra định danh client Web Google để từ chối các client có cùng phần số đầu hoặc định dạng không thể kiểm tra trong live. Phần số đầu chỉ là điều kiện từ chối bảo thủ, không thay thế readback quan hệ client/project trong Cloud Console. Credential mới ghi client đã cấp grant; disconnect không gửi revoke cho credential cũ thiếu hoặc khác client đó.

**Tech Stack:** TypeScript, Express, PostgreSQL, Vitest, Chromium, Orca Computer Use, Google Cloud Console.

**Spec:** `docs/superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md`, mục 1.2; `docs/handoff/tasks/FLOW-07-live-acceptance.md`. Bổ sung cùng PR #280; giữ main và mọi thay đổi của agent khác.

## Global Constraints

- Dịch vụ cá nhân không rơi về credential chung. Không đổi scheduler hoặc thực thi workflow thật trong thao tác cấu hình.
- Không revoke grant hiện có để thử. Không ghi client secret, code, token, cookie hoặc thông tin tài khoản thật vào git/log công khai.
- Không sửa CURRENT-STATE/ROADMAP; cập nhật kết quả FLOW-07 và một log P1.
- Mã nguồn có thể ngăn cấu hình sai nhưng không chứng nhận project thực tế; cấu hình Cloud phải được đọc lại riêng.
- Giữ PKCE, state/user/session/browser binding, khóa DB và invalidation cache hiện có.

## Review Focus

1. Tên project khai báo khác nhau nhưng client cùng phần số đầu phải bị chặn.
2. Client của dịch vụ tắt hoặc Google sign-in vẫn có grant; không bỏ khỏi so sánh chỉ vì flag tắt.
3. Cấu hình chỉ Gmail hoặc client không kiểm tra được cũng không được bỏ qua guard live.
4. Token thiếu client gốc hoặc client cũ sau migration không được đưa vào revoke với client mới; xóa kết nối tại ATI vẫn phải có hiệu lực.
5. Disconnect/reconnect đồng thời, token refresh đang chờ và adapter giữ provider cũ phải bị chặn sau local disconnect; cập nhật phạm vi giữ binding client.

### Task 1: Guard live project separation

**Files:**
- Create: `apps/chat-api/src/config/google-oauth-projects.ts`.
- Modify: `apps/chat-api/src/config/env.ts`, `apps/chat-api/src/app.ts`.
- Test: `apps/chat-api/tests/config/mycalendar-projects.test.ts`, `mysheets-config.test.ts`, `gmail-env.test.ts`, và test trực tiếp production composition.

**Interfaces:** `assertSeparateGoogleOAuthProjects(clients: Array<{ name: string; clientId: string }>): void`. Chỉ chạy trong live khi có kết nối Google cá nhân. Từ chối cùng client, cùng phần số đầu hoặc định dạng client Web không kiểm tra được; lỗi không chứa secret. Giữ kiểm tra project ID hiện có và xét thêm client sign-in.

- [x] Viết test RED: cùng phần số đầu + tên project khác; flag tắt nhưng client còn cấu hình; Gmail-only; sign-in chung; ID lỗi; ba ID chuẩn khác nhau được chấp nhận.
- [x] Chạy test, xác nhận fail đúng lỗi thiếu guard.
- [x] Implement helper và gọi ở env validation / createApp live trước khi tạo route.
- [x] Chạy lại test và typecheck; giữ sandbox fixture tương thích.

### Task 2: Credential origin during client migration

**Files:**
- Modify: `apps/chat-api/src/routes/connections/gmail.ts`, `mycalendar.ts`, `mysheets.ts`.
- Modify: `apps/chat-api/src/db/repositories/gmail-connection-repo.ts`, `apps/chat-api/src/services/gmail/token-manager.ts`, `apps/chat-api/src/server.ts`, `apps/chat-api/src/routes/services-routes.ts`.
- Modify: `apps/chat-api/src/services/adapter-factory.ts`; Create: `apps/chat-api/src/services/gmail/credential-origin.ts`.
- Create: `apps/chat-api/src/services/gmail/revocation.ts`.
- Test: ba file route connections và `apps/chat-api/tests/services/google-project-revocation.test.ts`.
- Update contracts: `docs/handoff/tasks/GMAIL-common.md` và log FLOW-07.

**Interfaces:** encrypted credential thêm `oauthClientId: string` khi OAuth thành công. Chỉ revoke một credential đã lưu khi `oauthClientId` khớp `options.oauth.clientId`; không suy ra origin từ email/tên project. Credential thiếu/mismatch vẫn bị xóa tại ATI và cache bị invalidated, nhưng provider grant được giữ để tránh ảnh hưởng dịch vụ khác. Kiểm thêm credential/flow Google ngang hàng trong DB, kể cả dịch vụ đã bỏ cấu hình, trước mỗi revoke. Ghi giới hạn migration trong handoff; không coi local disconnect là bằng chứng Google đã thu hồi grant.

`GmailConnectionRepo.disconnect(userId, cleanup?)` giữ khóa service/user và các credential Google liên quan tới khi cleanup revoke kết thúc; không để remote revoke chạy sau commit. `withLockedConnection` bổ sung danh sách peer và xét các mode Google khác. `GmailTokenManager` nhận clientId/encryptionKey của live config để kiểm DB/origin trước trả token và sau refresh; provider lưu generation lúc tạo, generation cũ/credential đã xóa luôn AUTH_ERROR. Services và các route Calendar/Sheets báo reconnect_required trước dùng origin cũ; scope update chỉ giữ origin đã xác nhận, không backfill.

- [x] Test RED qua HTTP fixture + PostgreSQL: peer grant còn refresh được sau disconnect legacy/mismatch; credential mới đúng client vẫn revoke bình thường.
- [x] Test binding được lưu và giữ qua chọn lịch/chọn bảng tính.
- [x] Test RED SQL + HTTP barriers: start/save không lọt qua revocation đang chạy; refresh đang chờ/old provider không trả token sau DELETE/clear.
- [x] Implement ba route, repo cleanup có khóa, token-manager invalidation và live origin gate. Token/client mismatch báo reconnect_required trước provider request.
- [x] Test callback lỗi không được tới Google nếu cấu hình live bị guard từ chối; fixture cùng project vẫn chứng minh phạm vi revoke của Google.
- [x] Chạy hồi quy Google routes/repository/token manager và concurrency thật.

### Task 3: Cloud configuration and acceptance

**Files:** cấu hình live `.env` ngoài git; artifact riêng `.audit/google-grant-p1/`; không commit credential.

- [x] Dùng Orca inventory project/clients hiện có; xác nhận ba client cá nhân cùng project. Preflight bản vá từ chối cấu hình này. Console chặn tạo project mới vì free trial project limit; không thay `.env` hoặc client cũ.
- [ ] Tạo ba project riêng khi có quota hoặc project trống được chỉ định. Có thể thuộc ba tài khoản quản trị khác nhau; sign-in giữ client hiện có và cần readback project trước nghiệm thu.
- [ ] Tạo OAuth Web client đúng redirect đã dùng; cấu hình branding, audience/test user và scope theo từng dịch vụ. Gmail: Gmail API; Calendar/Meet: Calendar API; Sheets/Docs/Drive: Sheets, Drive, Docs và Picker APIs.
- [ ] Sheets Picker API key/app ID phải thuộc project Sheets mới; cấu hình giới hạn phù hợp với origin callback hiện hành.
- [ ] Download JSON client đúng lúc tạo, đọc project/client ID trực tiếp; chỉ lưu secret vào cấu hình được chỉ định, không in secret hoặc token.
- [ ] Cập nhật đúng các biến OAuth/Picker trong `.env`, so sánh nội dung cũ trước ghi để giữ thay đổi đồng thời của người khác. Không revoke/xóa client cũ.
- [ ] Đọc lại Cloud project/client/API enabled và chạy env preflight trên bản vá. Cần consent mới cho từng dịch vụ; nếu chưa hoàn tất, ghi NOT_RUN.
- [x] Chạy `npm run check`, browser phù hợp, review độc lập và bàn giao code qua PR #280. CI final head được theo dõi tại checks của PR; giữ FLOW-07 OPEN cho tới đủ native acceptance.

## Kết quả triển khai và điều kiện còn thiếu

- Task 1/2 có regression PostgreSQL + HTTP thật, review độc lập và Chromium hồi quy. Review bổ sung loại suy luận danh tính từ email, invalidation chéo dịch vụ, invalidate sau CAS thất bại và phân biệt scope/connection change với mất grant.
- Caller bị hủy trong lúc chờ origin read DB dừng chờ ngay; query DB đang xếp hàng không bị hủy, nhưng không trả token cho caller đã hủy.
- [Runbook chuyển project](../../runbooks/google-project-isolation.md) bao gồm Picker, reconnect/reselect, không chạy lẫn phiên bản cũ/mới và giới hạn cùng Google Account dùng bởi nhiều ATI user.
- Cloud/API key/consent native sau migration **NOT_RUN**. Quota là blocker tạo tài nguyên, không phải lý do bỏ guard hoặc tự thu hồi grant cũ.
