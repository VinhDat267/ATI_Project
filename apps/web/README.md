# web — WEB-01B fixture workspace

Cấu trúc sản phẩm: [UX platform](../../docs/superpowers/specs/2026-09-15-platform-ux-design.md), 6 view/4 mục điều hướng. WEB-00 chọn [React + TypeScript + Vite](../../docs/ADR-001-FRONTEND-STACK.md) ([ADR-002](../../docs/ADR-002-FRONTEND-UI-DATA-LAYER.md) bổ sung Tailwind CSS v4, shadcn/ui và TanStack Query; chưa cài) dựa trên đo lock/build mẫu trong thư mục tạm. [Kế hoạch WEB-01–03](../../docs/superpowers/plans/2026-09-15-frontend-platform.md) bắt đầu từ WEB-01A.

WEB-01B hiện có store snapshot ổn định, session memory-only với request scope/AbortController, hash navigation an toàn, fixture `Transport` parse qua các schema DSL thật và AppShell login gate. Fixture build hiển thị nhãn `Dữ liệu mô phỏng`; live build dùng HTTP transport hybrid: ưu tiên cookie OIDC BFF, chỉ dùng bearer cho compatibility password auth khi API cho phép.

Các lệnh chính:

```powershell
npm run typecheck -w @wap/web
npm run test:unit -w @wap/web
npm run build -w @wap/web                 # fixture mặc định
npm run build -w @wap/web -- --mode live  # entry live, cookie OIDC + compatibility bearer client
npm run test:browser -w @wap/web
```

Fixture có thể chọn một trong 14 run status bằng query `?scenario=<status>`. Query chỉ chọn dữ liệu mô phỏng và không bỏ qua login gate. Token fixture chỉ nằm trong session JavaScript của tab; không lưu vào storage, URL hoặc DOM. Phạm vi còn lại theo [BASELINE](../../docs/BASELINE.md), [lịch](../../docs/KE-HOACH-6-TUAN.md) và [execution contract](../../docs/EXECUTION-CONTRACT.md).
