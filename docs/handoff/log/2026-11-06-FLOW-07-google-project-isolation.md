# FLOW-07 — P1 project Google dùng chung và chuyển OAuth client

- Ngày: 06/11/2026, Asia/Bangkok. Task: [FLOW-07](../tasks/FLOW-07-live-acceptance.md).
- Nhánh `fix/gmail-post-consent`, mở rộng PR #280 sau commit P2 `f877f6e9`; giữ checkout có thay đổi của agent khác. Không sửa CURRENT-STATE/ROADMAP, không merge, không bật scheduler.
- Chủ dự án chọn tách project + chặn cấu hình sai, giữ khả năng thu hồi quyền độc lập. [Plan](../../superpowers/plans/2026-11-06-google-project-isolation-fix.md), [runbook](../../runbooks/google-project-isolation.md).

## Hành vi

- Live env kiểm tra cả inferred-on Gmail, Calendar, Sheets, client còn cấu hình khi flag tắt và Google sign-in. Từ chối project khai báo trùng, client trùng, namespace số trùng/không kiểm tra được; direct live `createApp` cũng kiểm các client được truyền vào. Picker app ID cũ khác namespace Sheets bị từ chối. Đây là deny check; Cloud ownership cần xác minh riêng.
- Fresh callback ghi `oauthClientId` trong encrypted config; scope update giữ origin. Credential legacy/mismatch báo reconnect trước token refresh, trả cache hoặc chọn tài nguyên.
- Disconnect giữ user/service lock qua provider revoke có deadline; xét peer Google credentials và OAuth flows trong DB của cùng ATI user, kể cả khi dịch vụ peer đã bỏ cấu hình. Legacy/mismatch/unknown/shared peer giữ provider grant, nhưng local row/state bị xóa và provider/cache cũ bị vô hiệu hóa.
- Provider giữ generation lúc tạo; xác minh active row/id/origin/refresh token trước cache và sau refresh. `clearPersonal(user, service)` và toàn bộ runtime callbacks invalidation theo dịch vụ. CAS thất bại của credential cũ không invalidate credential mới; `GOOGLE_CONNECTION_CHANGED` không chuyển grant còn hợp lệ sang reconnect_required.
- Không dùng khác email làm bằng chứng grant độc lập vì email Google Account có thể thay đổi. Caller abort trong lúc chờ origin read DB dừng chờ ngay, không nhận token; query DB xếp hàng vẫn hoàn tất sau đó.

## Bằng chứng code và fixture

- RED guard: **9 FAIL / 2 PASS**, đúng thiếu guard live; sau sửa 4 file **38 PASS**. Picker migration guard bổ sung: **1 FAIL**, sau sửa hai file **23 PASS**.
- RED token origin/generation: **6 FAIL / 7 PASS**, thật HTTP refresh và PostgreSQL delete. RED grant/disconnect: **19 FAIL / 3 PASS**, gồm legacy origin, peer, fresh binding và SQL lock khi HTTP revoke đang chờ.
- Review phát hiện stale email: regression **6 FAIL**, sau sửa giữ peer grant. Phát hiện stale invalid_grant callback: **1 FAIL**; scope-change classification **2 FAIL**; cache abort và prompt abort khi pool hết connection đều **1 FAIL** trước sửa.
- Bộ hồi quy liên quan: **34 file / 287 PASS**, trước hai ca Picker bổ sung. Bộ cuối của token manager + Google grant isolation **50/50 PASS**, exit 0. Calendar/Sheets có assertions origin còn nguyên sau scope update.
- Chromium: **30/30 PASS**, exit 0 — Gmail **12**, Calendar **8**, Sheets **10**. Kiểm tra trực quan Gmail reconnect mobile và Gmail API disabled desktop; đây là sandbox/fixture UI, không phải consent Google thật.
- Review độc lập không còn P1/P2 cụ thể trong code: 5 file **105 PASS**, Calendar rerun **33 PASS**, Picker **23 PASS**, token manager cuối **17 PASS**. Probe PostgreSQL + HTTP với response cũ giữ lại: trước sửa request cũ và mới đều 409, credential mới bị reconnect_required; sau sửa request cũ 409 / mới 200, credential mới active và grant vẫn dùng được.
- Private artifacts: `.audit/google-grant-p1/`, gồm RED/GREEN, browser, source hashes và `independent-review-summary.json`. Không commit OAuth inputs, token, secret hoặc tài khoản thật.
- `DATABASE_URL=<isolated PostgreSQL> VITEST_MAX_WORKERS=2 npm run check`: **PASS, exit 0**. Schemas **579**, adapters **636**, planner **547**, executor **55**, API **2.535**, web **1.188**, evaluations **500 PASS / 1 preflight chủ động SKIP**; typecheck/build/web build security/launcher/Node PASS. Web có stderr JSDOM navigation hiện có, không có test fail.
- Delta cuối về hủy chờ origin read được thêm khi lượt tổng đã bắt đầu: sau delta chạy lại token + grant **50 PASS**, reviewer token **17 PASS**, lưu source hashes riêng. CI final head theo checks của PR #280; không lấy CI P2 cũ thay CI P1. Lượt đầu chạy đồng thời lúc bổ sung RED bị superseded, không tính là PASS.

## Cấu hình thật và giới hạn

- Orca đọc Console xác nhận ba client Gmail/Calendar/Sheets đang ở cùng một project; tên project khai báo khác không phản ánh ownership thực tế. Preflight `.env` thật bằng validator mới trả `REFUSED`: Gmail/MyCalendar phải dùng project riêng. Không khởi động app live trong probe này.
- Console chặn New project với “You've reached your free trial project limit”. Chưa tạo project/client mới, chưa thay `.env`, chưa revoke/xóa client/grant cũ. Bằng chứng quota là accessibility tree; ảnh vùng cửa sổ bị ứng dụng khác che nên không dùng làm screenshot proof.
- Chủ dự án hỏi tạo ba project trên ba tài khoản khác nhau: phù hợp với OAuth External, cần cấu hình API/client/test user riêng. Chưa có project mới được chỉ định để hoàn tất migration.
- **Native Cloud migration, OAuth consent thành công sau migration, Picker thật, ngắt một dịch vụ rồi provider readback peer: NOT_RUN.** FLOW-07 vẫn OPEN.
- Review không chứng nhận chạy lẫn nhiều instance/phiên bản, cùng Google Account được liên kết bởi nhiều ATI user, native provider/model/scheduler hoặc đủ 18 lượt workflow. Runbook yêu cầu dừng các process cấu hình cũ trước chuyển.
