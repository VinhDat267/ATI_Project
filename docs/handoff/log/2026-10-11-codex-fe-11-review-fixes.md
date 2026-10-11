# FE-11 — Sửa sau review PR #129

- Ngày: 11/10/2026, Asia/Saigon.
- Task: [FE-11](../tasks/FE-11-frontend-bugfixes.md), PR [#129](https://github.com/VinhDat267/ATI_Project/pull/129).
- Review: [P2/P3](https://github.com/VinhDat267/ATI_Project/pull/129#issuecomment-6099178321), [email Git và rebase](https://github.com/VinhDat267/ATI_Project/pull/129#issuecomment-6099498965).
- Base sau rebase: `origin/main` tại `84a3461`; mã sản phẩm cuối `ca2cffb`, thêm assertion scroll-lock `63123e3` (sau bản sửa review `9f1b796`).

## Thay đổi

- P2-1: fixture browser ghi user message sớm hơn assistant một giây, tránh thứ tự ngẫu nhiên khi UUID phá hòa timestamp. Rời app bằng `about:blank` trước `logout-all`, sau đó mở lại URL hội thoại, bảo đảm lần tải mới là lần phát hiện phiên bị thu hồi. Không thêm cơ chế lưu thông báo hết phiên vào production.
- P2-2/C7: spy `apiClient.getAuthConfig` vẫn gọi HTTP thật của fixture; chờ mọi promise config hoàn tất trong `act` trước assertion, gồm cả ca Google bị tắt. Server fixture luôn trả config chậm 200 ms; không tăng timeout.
- P3-1: thêm hai ca callback Google cùng/khác người dùng, kiểm URL gồm search/hash và consume đích một lần.
- P3-2: thêm bốn tổ hợp SSE disconnected/browser offline ở mức `Workspace`, dùng `Cockpit` thật và kiểm heading lỗi thực tế.
- P3-3: dùng câu “Phiên đăng nhập đã kết thúc ở một tab khác.” vì `storage` không cho biết nguyên nhân token bị xóa.
- Khi chạy canonical browser, phát hiện thêm lỗi sản phẩm có sẵn ở `main`: timer 100 ms của hộp đăng nhập giành focus về email sau khi người dùng đã chuyển sang mật khẩu. Thay bằng `useLayoutEffect` đặt focus khi DOM sẵn sàng; theo dõi boolean `signupEnabled` để focus trường đăng ký khi config về, không giành focus của input đang sửa, luôn giữ cleanup scroll lock. Không đổi giao diện, dependency, Vite, timeout hoặc retries. Đã rà hooks/accessibility bằng checklist `vercel:react-best-practices`.
- Sửa email Git global thành noreply của `longnguyen005`; rebase riêng nhánh PR lên `84a3461` và reset author cho cả 10 commit. Giữ cả `FE-10:` và `FE-11:` trong runner; giải xung đột Google bằng bản chờ phản hồi, bỏ timeout 5 giây của FE-10. Không viết lại lịch sử `main` hoặc commit FE-10 đã merge.

## Bằng chứng kiểm thử

- RED C7 trước sửa helper: với config chậm 200 ms, ba ca hiện Google fail vì chưa có nút; hai ca ẩn Google pass dù phản hồi chưa về, chứng minh assertion cũ chưa đủ. Lần chạy trực tiếp Vitest từ root thiếu setup jest-dom nên các gate sau dùng đúng `npm test -w @wap/chat-web`.
- Mutation Google: thay callback bằng `navigate('/', true)` làm ca cùng người dùng fail (`/` khác `/settings?tab=apps#notion`). Mutation Workspace: bỏ `networkError` làm ba tổ hợp mất kết nối fail. Kết quả hai mutant: 4 fail/2 pass; đã khôi phục mã sản phẩm trước gate.
- Focused frontend: `npm test -w @wap/chat-web -- tests/auth-google.test.tsx tests/auth-return-target.test.tsx tests/fe-06b-errors.test.tsx`: exit 0, **58/58**.
- RED focus: test chuyển con trỏ sang password rồi tiến đồng hồ 100 ms fail trên timer cũ (expected password focus, received email). Sau sửa, thêm kiểm focus ban đầu của login/signup/forgot; `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx tests/auth-google.test.tsx tests/auth-return-target.test.tsx tests/fe-06b-errors.test.tsx`: exit 0, **82/82**.
- Rà tác dụng phụ theo checklist React: thêm assertion body/html được khóa cuộn khi mở modal qua route và mở khóa khi đóng; `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx`: exit 0, **24/24**, không cần sửa production thêm.
- Browser FE-11 sau rebase: `node --env-file-if-exists=.env node_modules/playwright/cli.js test --config apps/chat-web/playwright.config.ts --grep 'FE-11:' --repeat-each 20 --workers 1`: exit 0, **20/20**, 1,1 phút.
- Chạy lại cùng lệnh browser FE-11 sau sửa focus trên `ca2cffb`: exit 0, **20/20**, 48,3 giây.
- `npm run check` sau rebase: exit 0, **1.670 v3** (47 schema + 340 adapter + 212 planner + 25 executor + 371 API + 675 web) **+ 173 eval**. Typecheck, build, security scan, launcher 1/1 và env/OIDC 10/10 đều đạt.
- `npm run check` trên `ca2cffb` sau sửa focus: exit 0, **1.674 v3** (47 + 340 + 212 + 25 + 371 + 679) **+ 173 eval**; typecheck, build, security scan, launcher 1/1 và env/OIDC 10/10 đều đạt.
- Chốt lại `npm run check` trên `63123e3`, gồm assertion scroll-lock: exit 0, cùng **1.674 v3 + 173 eval**, typecheck/build/security/launcher/env đều đạt. Repo không có script lint riêng.
- Lượt check đầu chạy đồng thời browser chạm giới hạn PostgreSQL 100 kết nối (`sorry, too many clients already`); chạy riêng lại toàn bộ check trên cùng mã đạt. Không sửa product hoặc cấu hình DB để che lỗi môi trường.
- Google config chậm 200 ms: vòng lặp `npm test -w @wap/chat-web -- tests/auth-google.test.tsx` đạt **20/20 lượt**, **43/43 mỗi lượt**, tổng **860 executions**, mọi lượt exit 0.
- Chạy lại vòng Google 20 lượt trên bản focus cuối: **20/20 lượt**, **43/43 mỗi lượt**, tổng **860 executions**, exit 0; chạy đồng thời với canonical browser trong một phần thời gian.
- **Gate browser cuối:** `npm run test:browser:v3` exit 0, **101 pass/1 skip có chủ đích**, đủ 11 scenario: default 83 pass/1 skip, auth02 2, auth04 6, clarification 2, partial_failure 2, sáu nhóm dịch vụ 6. Sau sửa focus các ca login từng lỗi đều đạt, không tăng timeout/retries.
- `npm run test:browser:v3` sau rebase, **trước sửa focus**, đã chạy hai lượt chưa đạt toàn suite; cả hai lượt FE-11 đều đạt. Giữ các kết quả thất bại dưới đây để phân biệt với gate cuối, không che bằng timeout/retry hoặc thay assertion.
- Canonical lượt đầu: nhóm default **82 pass, 1 skip, 1 fail** ở ca recovery cũ `v3-sandbox.spec.ts:13`; runner dừng trước 10 nhóm còn lại. Error context cho thấy dữ liệu mật khẩu bị điền vào email và trường mật khẩu còn trống; ca FE-11 đạt. Không commit error context chứa dữ liệu đăng nhập, không tăng timeout hay sửa luồng recovery ngoài task; chạy lại canonical trên cùng mã.
- Canonical lượt hai: default **80 pass, 1 skip, 3 fail** ở `AUTH-01: logout…`, `FE-05b compact header…1440 light`, `FE-06B responses…1440 light`, đều tại bước đăng nhập trước nội dung nghiệp vụ. Đối chiếu `LandingPage.tsx:119–123` với `origin/main` cho thấy timer focus 100 ms về email tồn tại ở cả hai bản. Error context AUTH-01 cũng có mật khẩu ở email và password trống. Sau đó tái hiện bằng unit test RED và sửa root cause trong `ca2cffb`.
- Trước sửa focus, chạy riêng 10 scenario còn lại bằng đúng mã runner, chỉ lọc `default` trong bộ nhớ: **17 pass/1 fail** (Jira fail tại bước đăng nhập với cùng dấu hiệu focus). Không sửa runner, Playwright config hoặc retries để làm gate xanh.

## Môi trường và giới hạn

- Gate dùng sandbox và PostgreSQL local riêng tại loopback cổng 55533; không dùng DB live, không sửa `.env`. Không xóa volume hoặc dữ liệu phát triển.
- Build cuối sau tích hợp FE-10 và sửa focus: main JS **877,41 kB**, gzip **216,08 kB**; cảnh báo >500 kB vẫn còn. D1/D2 tùy chọn chưa làm.
- Bằng chứng ảnh trước/sau và RED ban đầu giữ tại [log thi công](2026-10-10-codex-fe-11-frontend-bugfixes.md). Kết quả Google 20/20 của log cũ dùng fixture không trễ và chưa chứng minh C7; kết quả sửa review trong log này thay thế kết luận đó.
- Không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md`. Chưa merge; reviewer cần kiểm lại trên head mới.
- Người dùng đã xác nhận cho phép `--force-with-lease` chỉ cho nhánh PR #129 sau khi gate đạt. Dùng lease khóa vào head remote cũ `74893806b7b17d9da548336013d0f7c621d04bce`; nếu remote đổi, dừng thay vì ghi đè. Không đẩy `main`.
