# ADR-001 — React + TypeScript + Vite cho frontend B/local

Ngày: 15/09/2026. **DECIDED_FOR_PLAN** trong WEB-00. **PARTIALLY_SUPERSEDED 17/09/2026:** phần CSS thuần, “không UI kit/query cache/React plugin” và budget 160 KiB được thay bởi [ADR-002](ADR-002-FRONTEND-UI-DATA-LAYER.md) (Tailwind CSS v4, shadcn/ui trên Radix, TanStack Query, Fast Refresh); renderer, proxy, hash routes và ràng buộc bảo mật dưới đây vẫn hiệu lực. WEB-01B đã tạo fixture shell ở trạng thái **PROVISIONAL_IMPLEMENTATION**; live frontend chưa tích hợp API. System design cấp hệ thống là [tài liệu riêng](superpowers/specs/2026-09-15-platform-system-design.md) và phải được duyệt trước WEB-01C/WEB-02. Người dùng đã giao bước đánh giá stack và lập kế hoạch sau [thiết kế UX](superpowers/specs/2026-09-15-platform-ux-design.md). Phạm vi điều hướng là 6 view/4 mục chính; workflow editor, workflow tái sử dụng và SaaS vẫn ngoài B.

## Quyết định

Dùng **React 19.3.0 + TypeScript 5.9.3 + Vite 8.3.0**, CSS thuần, browser hash routes và shared Zod contracts. Dùng Vitest 4.1.11 cho logic thuần; Playwright Test 1.63.0 cho browser. Các version này được đọc từ registry/lock và build thử tại thời điểm quyết định hoặc đợt vá bảo mật kế tiếp, không phải cam kết luôn là mới nhất.

Không thêm router library, global state library, query cache library, UI kit hoặc React plugin trong đợt đầu. JSX automatic transform qua Vite đủ cho build; chấp nhận full reload khi chỉnh component thay vì Fast Refresh. Sáu hash routes có parser nhỏ, không xây router tổng quát. React quản lý DOM; state machine/domain/API client không phụ thuộc React. Dùng hook `useSyncExternalStore` cho snapshot có identity ổn định, effect cleanup để dừng poll. Backend vẫn là authority của status và approval.

## Căn cứ được đo

Nguồn: [measurement.json](web-evidence/WEB-00/measurement.json), tái chạy bằng `node docs/web-evidence/WEB-00/measure.mjs` từ root. Script tạo thư mục tạm mới, chỉ copy package manifests/lock và ba file DSL thuần; không copy env, DB hoặc secrets. Cài ứng viên bằng `npm ci --ignore-scripts`, không thay node_modules/lock của workspace chính. npm control không đổi số mục hoặc tập name@version của baseline.

| Ứng viên có cùng Vite + Playwright + parser | Mục node_modules trong lock | Tăng so 258 | JS mẫu, bytes | Gzip mẫu, bytes |
|---|---:|---:|---:|---:|
| TS + DOM + Vite | 297 | 39 | 102547 | 28809 |
| Preact + Vite | 298 | 40 | 113055 | 33153 |
| React + Vite + React types | 303 | 45 | 321437 | 96099 |

Đây là lock entries gồm optional platform binaries, không phải số package Windows đã cài. Cả ba dùng `RunDetailSchema` thật và cùng sáu nhãn view, **không phải ứng dụng sáu view hoàn chỉnh**. Build đều exit 0; chưa đo focus, polling, tốc độ render hoặc trải nghiệm browser. Gzip là phép nén offline bằng Node, không phải network transfer được đo. Không package name@version cũ nào bị loại trong probe; điều đó không thay kiểm installed-byte fingerprint của MCP khi thực sự cài.

Phần tăng của React so với DOM là 6 entries và 67290 bytes gzip mẫu. Phần lớn mức tăng 45 entries đến từ build/browser-test tooling dùng chung; không có cơ sở nói React kéo thêm vài trăm package trong cấu hình này. TS + tsc không bundler có thể thêm 0 package, nhưng chưa giải quyết bare ESM specifier và runtime Zod parser để chạy browser; không so con số đó với một cấu hình đã build được rồi kết luận tương đương.

## Vì sao chọn React

- UI có nhiều trạng thái tương tác đồng thời: form đang nhập, disclosure đang mở, approval đang gửi, event page về muộn và phiên đăng nhập đổi. Component lifecycle và keyed reconciliation giảm lượng mã cập nhật DOM cần tự duy trì. Đây là nhận định thiết kế, chưa có số đo giờ phát triển.
- Chi phí bundle tăng đã thấy được và chấp nhận cho prototype local. Chọn Preact là hợp lý nếu ngân sách bundle thành ràng buộc chính; hiện chưa có yêu cầu đó. Không chọn Preact chỉ để tiết kiệm 5 entries rồi phải giải thích thêm khác biệt tương thích nếu dùng hệ sinh thái React về sau.
- Kinh nghiệm React của hai thành viên chưa được xác minh; kế hoạch phải có phần giải thích kiến trúc và walkthrough. Không dùng nhận định “ai cũng biết React” làm bằng chứng.
- React không tự giải quyết lost response, duplicate write, stale approval hoặc cleanup. Những hành vi này thuộc modules thuần và kiểm thử riêng. Thêm màn hình/editor tương lai vẫn cần scope/API mới.

React có tài liệu chính thức cho [ứng dụng bắt đầu bằng build tool](https://react.dev/learn/build-a-react-app-from-scratch) và [external store](https://react.dev/reference/react/useSyncExternalStore). Preact ghi rõ [khác biệt với React](https://preactjs.com/guide/v10/differences-to-react/). Vite mô tả [TypeScript/JSX](https://vite.dev/guide/features) và [proxy](https://vite.dev/config/server-options). Đây là căn cứ kỹ thuật; quyết định phạm vi thuộc repo.

## Ràng buộc triển khai

1. `apps/web/package.json` khai báo exact versions kể trên; thêm `react-dom@19.3.0`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `zod@4.6.2`, `@wap/dsl@0.1.0`. Vitest không được nâng chung với lúc thêm frontend; đợt bảo mật độc lập ngày 16/09/2026 đã đồng bộ ba khai báo trực tiếp lên 4.1.11 và lock chỉ còn một Vite 8.3.0.
2. Vite yêu cầu Node `^20.19.0 || >=22.12.0`; Vitest 4.1.11 hỗ trợ Node 22 hoặc 24+, không hỗ trợ Node 23. Vì vậy project khai báo **`^22.12.0 || >=24.0.0`**; máy kiểm là 24.19.0.
3. Gate dependency: số +45 entries là phép đo WEB-00 lịch sử. Mọi lock diff mới phải được giải thích riêng; đợt bảo mật 16/09/2026 đã đạt `npm audit` production và toàn bộ dependency đều 0 vulnerability, đồng thời `check:full` giữ nguyên coverage. Kiểm package integrity/installed closure và policy fingerprint trước luồng MCP thật; không sửa hash để ép gate xanh.
4. Budget đề xuất cho WEB-01: tổng JS production được tải ban đầu <=160 KiB gzip (gồm parser), không remote fonts/CDN. Đây là ngưỡng review tương lai, chưa phải số đo UI. Vượt ngưỡng thì phân tích module/bundle rồi review, không bỏ runtime validation để giảm size.
5. TS browser config riêng: ES2022, ESNext/Bundler, `jsx: react-jsx`, DOM libs, strict/noUncheckedIndexedAccess, noEmit. Root NodeNext config giữ riêng; root check phải gọi web typecheck và tests rõ ràng. Vite build không thay typecheck.
6. Thêm public entry `@wap/dsl/browser` chỉ export schema/events/contracts thuần. Browser không import engine/db/fs/crypto hoặc barrel chứa server-only module. Build probe hiện copy ba source thuần; WEB-01 phải kiểm entry package thật trong bundle.
7. Token chỉ memory; không persistence query cache. Sau reload đăng nhập lại; chỉ route chứa ID được giữ. `.env` backend không thành `VITE_*`; frontend chỉ có compile-time label fixture/live và mẫu prompt công khai đã allowlist.

## HTTP origin và local serving

API hiện chỉ bind 127.0.0.1 và chặn Origin khác API origin. Frontend gọi relative `/api/v1`; dùng Vite dev/preview proxy loopback với target do server config lấy từ `WAP_API_TARGET`, mặc định `http://127.0.0.1:3001`. Biến này không được expose sang bundle. Chỉ chấp nhận target HTTP 127.0.0.1 có port, không userinfo/path/query/fragment; không proxy URL từ người dùng.

**Không chỉ bật `changeOrigin: true`: tùy proxy, nó đổi Host nhưng chưa chắc đổi Origin.** Trước proxy, middleware kiểm Host đúng frontend loopback origin, Origin nếu có phải bằng origin frontend; chặn Sec-Fetch-Site cross-site và OPTIONS không hỗ trợ. Sau kiểm mới thay Origin thành target origin; giữ Authorization, path, body nguyên. Không cấu hình CORS `*`, không tắt guard ở API. Dev và preview dùng chung logic; proxy không có route điều khiển DB/fixture.

Vite chỉ phục vụ demo local/dev, không được quảng cáo server production. `dev` cổng 5173, `preview` 4173, strictPort, bind127.0.0.1, no auto-open, no console forwarding. WEB-01 có test HTTP proxy giả; WEB-02 phải đăng nhập qua browser/proxy/API thật. Browser gate chạy bản build qua preview để tránh nhầm HMR với cơ chế polling sản phẩm.

## Phạm vi, chi phí và khả năng đổi lại

Navigation sáu view thay điều khoản hai màn hình ở baseline/FR/lịch; giữ 14 statuses và các invariant. Không thêm FR CRUD/editor bằng việc đổi sidebar. Tool status dùng API hiện có; catalog live và kiểm preset còn cần task backend riêng.

Ước lượng làm việc có review: WEB-01 8–12 giờ, WEB-02 12–18 giờ, WEB-03 8–12 giờ, tổng 28–42 giờ; là dự báo mới, không phải giờ đã tiêu hay cam kết nằm trong 14 giờ UI cũ. Chưa gồm API-CATALOG, đóng API gate, hoặc AI. Sau WEB-01 đo thời gian thực rồi hiệu chỉnh lịch. Có thể thu nhỏ trang Tổng quan/Tools thành bố cục đơn giản; không cắt approval/reconnect/session/unknown safeguards.

Nếu đổi renderer, giữ contracts, API client, event reducer và controller; thay React adapters/views và browser snapshots. Thay đổi không miễn phí nhưng không buộc viết lại engine. Xem [kế hoạch triển khai](superpowers/plans/2026-09-15-frontend-platform.md).
