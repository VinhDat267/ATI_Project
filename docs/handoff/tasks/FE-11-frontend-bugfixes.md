# FE-11 · Dọn lỗi frontend sau FE-05 → FE-09

**Trạng thái:** đang làm, giao `longnguyen005` (thi công bằng Codex) ngày 10/10/2026; làm phần A trước FE-10 · **Nhánh gợi ý:** `fix/fe-11-frontend-bugfixes` · **Phụ thuộc:** không; làm song song được với FE-10 (không chung file, trừ khi FE-10 sửa `routes.ts`/`App.tsx` cho `/guide`, `/privacy`: gộp `main` trước khi mở PR) · **Mốc:** phần A trước **20/10/2026** (trước buổi thử W4-03 dự kiến 23–25/10); phần B, C trước **28/10/2026**
**Nguồn:** audit frontend của Claude Code ngày 10/10/2026 trên `main` `c99b7ba` (sandbox, PostgreSQL tạm, quét 84 tổ hợp route × khổ × chế độ) và các P3 còn mở trong `CURRENT-STATE.md` mục 5.

## Vì sao quan trọng

Audit không thấy lỗi mất dữ liệu, nhưng có một lỗi người dùng sẽ gặp trong buổi thử W4-03: phiên hết hạn khi đang xem kế hoạch thì đăng nhập lại bị đưa về trang trống. Các lỗi còn lại làm câu báo lỗi sai sự thật (báo mất mạng khi mạng vẫn tốt) hoặc là P3 đã mở từ các review trước. Gom vào một task để không rải thành nhiều PR nhỏ.

## Việc cần làm

Mỗi mục: viết test fail trước (TDD), ghi output fail thật, rồi mới sửa. Với giao diện có gọi API bất đồng bộ, thêm ca "phản hồi về sau khi người dùng đã đổi sang thứ khác" (đổi hội thoại, đăng xuất, đăng nhập tài khoản khác).

### Phần A — bắt buộc trước 20/10

**A1. Đăng nhập lại phải quay về trang đang mở.** Đã tái hiện bằng app thật:
- đang ở `/c/<id>`, phiên bị thu hồi (ví dụ `POST /api/auth/logout-all` từ tab khác) rồi tải lại → app chuyển sang `/login` và báo "Phiên đăng nhập đã hết hạn" → đăng nhập lại → về `/` (trang trống), không về `/c/<id>`;
- mở `/settings#notion` khi chưa đăng nhập → đăng nhập → về `/`, mất `/settings#notion`. `/account`, `/history`, `/admin/users` cũng vậy; chỉ `/c/:id` được giữ, và chỉ khi đăng nhập ngay tại URL đó.

Nguyên nhân: `apps/chat-web/src/components/AuthGate.tsx:44` gọi `navigate('/login', true)` khi mất phiên (xoá luôn đích đến); `AuthGate.tsx:81` chỉ giữ route khi `route.kind === 'conversation'`, còn lại `navigate('/', true)`.

Yêu cầu:
- Ghi lại đích đến (pathname + search + hash) khi mất phiên hoặc khi đăng nhập tại route được bảo vệ; sau đăng nhập thành công `navigate(<đích>, true)`.
- Chỉ nhận đường dẫn nội bộ: bắt đầu bằng một dấu `/`, không phải `//`, không có scheme; không nhận các route tài khoản (`/login`, `/signup`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`, `/auth/google/callback`). Không có đích hợp lệ thì về `/`.
- Đích chỉ dùng một lần và chỉ cho **cùng người dùng**: nếu người đăng nhập lại khác người vừa mất phiên thì về `/` (tránh mở `/c/<id>` của người khác, dù API đã chặn).
- Đăng xuất chủ động (`onLogout`) không lưu đích.
- Đăng nhập Google: nếu đích có thể đi qua luồng Google mà không đổi API thì giữ; nếu không, ghi rõ ở "Kết quả" là chưa hỗ trợ.
- Giữ nguyên các bảo đảm hiện có: màn pending/disabled/429 tại URL được bảo vệ (FE-08, `6bf51de`), câu "Phiên đăng nhập đã hết hạn", không đăng xuất khi refresh lỗi mạng.

### Phần B — câu báo lỗi sai sự thật

**B1. ID hội thoại sai định dạng làm API trả 500.** `GET /api/conversations/khong-ton-tai` → HTTP 500 "Không thể hoàn tất yêu cầu"; ID đúng định dạng UUID mà không tồn tại → 404 "Không tìm thấy hội thoại." (đúng). Nguyên nhân: `ConversationRepo.getConversation` (`apps/chat-api/src/db/repositories/conversation-repo.ts:37`) đưa chuỗi bất kỳ vào cột `uuid`, PostgreSQL báo lỗi cú pháp, route bắt lỗi và trả 500.
- Sửa ở một chỗ cho mọi nơi gọi: ID không phải UUID thì coi như không tìm thấy (repo PostgreSQL và repo bộ nhớ `memory-conversations.ts` cùng hành vi), để các route trả 404.
- Kiểm mọi route nhận ID: `conversation-routes.ts` (`/:id`, `/:id/plans/active`, `/:id/messages/latest`, `/:id/messages`, `PATCH /:id`), `stream-routes.ts` (`/:id/stream`), `execution-routes.ts` (`/conversations/:convId/executions/latest`, `/executions/:planId/...`, `/plans/:id/approve`, `/plans/:id/reject`). Route nào còn trả 500 với ID sai định dạng thì sửa theo cùng cách. Test HTTP trên PostgreSQL thật.
- Đây là phần backend nhỏ trong `apps/chat-api`; không đổi schema, không đổi hợp đồng API ngoài mã lỗi 500 → 404.

**B2. Lỗi 500 hiện thành câu báo mất mạng.** `apps/chat-web/src/services/user-error.ts` trả "Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại." cho mọi `status >= 500`. Tách: lỗi mạng thật (fetch thất bại) và 502/503/504 giữ câu kết nối; 500 dùng câu lỗi máy chủ (ví dụ "Máy chủ gặp lỗi. Hãy thử lại."). Kiểm các test đang khẳng định câu cũ và chỉ đổi khi đúng là ca 500.

**B3. Màn lỗi tải hội thoại thiếu `h1`.** `apps/chat-web/src/views/NotFoundView.tsx` (dùng ở `Workspace.tsx:249`) chỉ có `<p role="alert">` và nút. Thêm một `h1` (ví dụ "Không mở được hội thoại") để mỗi màn có đúng một `h1`; giữ `role="alert"` cho câu lỗi.

**B4. `getConversation` ở frontend không mã hoá ID.** `apps/chat-web/src/services/api-client.ts:357` ghép `/api/conversations/${id}` thô, trong khi `renameConversation` (dòng 350) dùng `encodeURIComponent`. `readRoute` giải mã `/c/a%2Fb` thành `a/b`, nên yêu cầu đi tới một đường dẫn API khác. Mã hoá ID ở mọi lời gọi API có ID hội thoại (kể cả URL SSE, execution snapshot nếu có).

### Phần C — P3 còn mở từ các review trước

**C1. Loại câu hỏi lại đoán bằng regex** (P3 #116, `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:15-16`). Câu hỏi cố định của W3-10 ("Bạn muốn làm gì với dữ liệu này, chẳng hạn…", `packages/planner/src/planner.ts:102`) không khớp regex `làm gì với danh sách`. Làm theo thứ tự, mỗi bước một commit:
1. `packages/tool-schemas/src/types.ts` (`ClarificationResponse`): thêm trường tuỳ chọn `reason?: 'read_only' | 'destination'` (thoả thuận interface trước, theo AGENTS.md mục 2);
2. `planner.ts` `readOnlyQuestion()` trả `reason: 'read_only'`;
3. `apps/chat-api/src/services/chat-service.ts:150-156` lưu `reason` vào metadata tin nhắn và sự kiện SSE `clarification`;
4. frontend ưu tiên `metadata.reason`, chỉ dùng regex khi tin nhắn cũ không có trường này (dữ liệu lịch sử).
Không đổi prompt; không cần đo lại golden (chỉ thêm trường vào đầu ra cố định), nhưng chạy lại test planner.

**C2. Màn lỗi lập kế hoạch luôn ghi "Sự cố máy chủ" kể cả khi mất mạng** (P3 #116, `apps/chat-web/src/pages/Errors/PlanningErrors.tsx:51`). Mất mạng thì dùng nhãn/tiêu đề mất kết nối theo bản React `errors.html`; lỗi máy chủ giữ như cũ.

**C3. "Phiên đăng nhập đã hết hạn" cũng hiện khi bị đăng xuất từ tab khác** (P3 #116, `AuthGate.tsx:44`). Khi tab khác đăng xuất chủ động (token bị xoá qua sự kiện storage, không phải refresh 401), dùng câu trung tính như "Bạn đã đăng xuất ở một tab khác." Phải phân biệt được hai nguồn bằng dữ liệu thật, không đoán.

**C4. Chốt `hydrateResponse` chỉ được test như một khối** (ghi chú review #118). Thêm hai ca trong `apps/chat-web/tests/fe-06b-responses.test.tsx`: (a) trong lúc tải lịch sử chỉ có tin nhắn mới (không có kế hoạch mới); (b) chỉ có `planRevision` đổi (không có tin nhắn mới). Bằng chứng: bỏ riêng điều kiện `messages` rồi riêng điều kiện `planRevision` ở `use-conversation-history.ts:11-12`, mỗi lần phải có test fail.

**C5. "Cuộc hội thoại mới" lỗi thì Back đi qua trang nháp** (P3 FE-03b, `apps/chat-web/src/components/Workspace.tsx:121`). Khôi phục route bằng `navigate(..., true)` (replace) thay vì push. Tái hiện: mở c2 → c1 → New trả 500 → Back phải về c2, không về `/`.

**C6. Thiếu test cho `openWhenHidden` của SSE** (`apps/chat-web/src/hooks/use-sse.ts:311`). Test rằng khi tab ẩn, kết nối SSE không bị đóng/mở lại (hoặc hành vi tương đương mà code đang cam kết).

**C7. Test frontend chập chờn khi máy tải nặng:** `apps/chat-web/tests/auth-google.test.tsx:74` (`findByRole` chờ mặc định 1 giây; lần fail trong audit mất 1.650 ms). Sửa bằng cách chờ đúng điều kiện (ví dụ chờ request `/api/auth/config` đã trả rồi mới tìm nút, như ca "hides Google…" ở dòng 80), **không** chỉ tăng timeout. Rà các test cùng mẫu trong file.

### Phần D — tuỳ chọn, làm nếu còn thời gian

**D1. Bundle chính 779 kB** (Vite cảnh báo > 500 kB). Tách code theo route bằng `React.lazy` cho các trang ít dùng (Account, Users, History, Settings). Ghi kích thước trước/sau.

**D2. Xoá component chết `MissionControlLaunchpad.tsx`** và hai file test chỉ dùng nó (`tests/components/mission-control-launchpad.test.tsx`, phần liên quan trong `service-naming.test.tsx`) sau khi xác nhận không còn nơi nào dựng nó. Dòng "Sandbox… minor sau FE-01" trong CURRENT-STATE mục 5 thuộc component này.

## Tiêu chí nghiệm thu

- [ ] A1: test unit `AuthGate` cho các ca: mất phiên tại `/c/<id>` rồi đăng nhập lại cùng người → về `/c/<id>`; khác người → `/`; đăng nhập tại `/settings#notion` → về `/settings#notion`; đích ngoài (`//evil.example`, `https://…`, `/login`) → `/`; đăng xuất chủ động không lưu đích. Test browser trên PostgreSQL thật: tạo hội thoại, thu hồi phiên bằng `logout-all`, tải lại, đăng nhập lại, URL là `/c/<id>` và hội thoại hiện đúng.
- [ ] B1: test HTTP trên PostgreSQL thật: mọi route nhận ID ở mục B1 với ID sai định dạng trả 404 (hoặc 400 có lý do), không có 500; ID đúng định dạng của người khác vẫn 403/404 như trước.
- [ ] B2–B4: test cho từng mục; `/c/khong-ton-tai` hiện "Không tìm thấy hội thoại." và có đúng một `h1`.
- [ ] C1–C7: mỗi mục có test, kèm output fail trước khi sửa. C4 có bằng chứng hai đột biến bị bắt. C7 chạy lặp ít nhất 20 lần đạt.
- [ ] Không đổi hình thức các trang đã chép từ bản React ngoài các chỗ trên; nếu C2/B3 làm đổi giao diện, chụp ảnh trước/sau ở 1440 và 375, sáng và tối (không commit ảnh, ghi SHA256 trong log).
- [ ] `npm run check` và `npm run test:browser:v3` exit 0; ghi số test thật.

## Ngoài phạm vi

- Test browser chập chờn liên quan Vite dev server (danh sách ở CURRENT-STATE mục 5): cần một task riêng (chạy browser trên bản build hoặc ghi request mạng khi lỗi).
- Nhánh streaming `text_*` (`use-sse.ts:65-76`): chưa có nơi phát sự kiện, giữ hoãn.
- API kiểm tra kết nối gọi dịch vụ thật ở sandbox: chờ người dùng chốt hành vi.
- Template lấy output dạng object hiện `[object Object]` ở "Sửa rồi thử lại" (`recovery-request.ts`): đúng như executor gửi; đo lại khi có W3-11/W4-02.
- Nội dung `/guide`, `/privacy`, đo tương phản, logo Jira: thuộc FE-10.

## Kết quả

- Hoàn thành phần A, B và C trên nhánh `fix/fe-11-frontend-bugfixes`; không làm phần D tùy chọn để giữ phạm vi nhỏ. Luồng đăng nhập lại lưu `pathname + search + hash` trong `sessionStorage`, chỉ dùng một lần, khóa theo người dùng khi biết phiên cũ, hỗ trợ cả mật khẩu và Google, và không lưu khi đăng xuất chủ động. Đăng xuất từ tab khác dùng thông báo trung tính dựa trên `storage` event thật.
- API từ chối UUID sai định dạng trước PostgreSQL. Test HTTP thật bao phủ 14 endpoint có conversation/plan ID và đều trả 404, không còn 500 hay rò lỗi database. Frontend mã hóa mọi conversation ID trong HTTP/SSE, phân biệt 500 với lỗi mạng/502–504, thêm đúng một `h1` cho lỗi tải hội thoại và phân biệt lỗi lập kế hoạch do mất mạng với lỗi máy chủ.
- `ClarificationResponse.reason` được truyền xuyên suốt interface → planner → API → frontend bằng bốn commit riêng; dữ liệu cũ vẫn dùng regex fallback. Hai mutant của `hydrateResponse` và mutant `openWhenHidden` đều bị test mới bắt. Back sau lỗi tạo hội thoại mới bỏ qua route nháp. Test Google chờ đúng request config và đạt 20/20 lượt (41 test/lượt).
- TDD RED thật đã được ghi cho từng mục: auth/storage; UUID repository; thông báo lỗi/h1/path encoding; planner/API/frontend reason; hai nhánh hydrate; history Back; SSE hidden; Google config. Bằng chứng chi tiết, lệnh test và 16 SHA256 ảnh trước/sau nằm trong [log FE-11](../log/2026-10-10-codex-fe-11-frontend-bugfixes.md). Ảnh được lưu ngoài repository tại `D:\ATI_Project\fe11-screenshots` và không commit.
- Gate cuối: `npm run check` exit 0 (1.658 test v3 + 173 eval, build/security/launcher/env đều đạt); `npm run test:browser:v3` exit 0 (98 pass, 1 skip trong 11 scenario) sau khi chạy lệnh provision chuẩn để khôi phục role admin của fixture cục bộ. Test browser FE-11 dùng PostgreSQL thật, thu hồi cả access/refresh session bằng `logout-all`, đăng nhập lại về đúng `/c/<id>` và hiện đúng hội thoại.
- Bundle production vẫn cảnh báo 781,33 kB > 500 kB; đây là D1 tùy chọn và chưa thay đổi trong task này.
