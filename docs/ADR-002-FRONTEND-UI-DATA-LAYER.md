# ADR-002 — Tailwind CSS v4, shadcn/ui và TanStack Query cho frontend B/local

Ngày: 17/09/2026. **DECIDED_FOR_PLAN** — người dùng yêu cầu phản biện stack frontend và đồng ý hướng đề xuất ngày 17/09/2026. ADR này **thay phần styling, component và data layer** của [ADR-001](ADR-001-FRONTEND-STACK.md); phần React + TypeScript + Vite, hash routes, Zod contracts, token memory-only, local proxy và các ràng buộc bảo mật của ADR-001 vẫn giữ nguyên. Chưa cài vào workspace; WEB-01B vẫn là `PROVISIONAL_IMPLEMENTATION`.

## Quyết định

Giữ **React 19.3.0 + TypeScript 5.9.3 + Vite 8.3.0 + Zod 4.6.2**, Vitest 4.1.11, Playwright Test 1.63.0. Thêm:

| Lớp | Package, version exact | Vai trò |
|---|---|---|
| Build | `@vitejs/plugin-react` 6.1.1 | JSX + Fast Refresh khi dev |
| Styling | `tailwindcss` 4.3.3, `@tailwindcss/vite` 4.3.3 | Utility CSS; token thiết kế khai báo bằng `@theme` từ DESIGN.md |
| Component | `radix-ui` 1.6.7, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0 | Primitive accessible; biến thể component |
| Component source | shadcn/ui, CLI `shadcn@4.21.0` chỉ dùng để sinh mã | Mã component được copy vào `apps/web/src/components/ui`, review và commit như mã của repo |
| Icon | `lucide-react` 1.47.0 | Icon SVG tree-shaken |
| Server state | `@tanstack/react-query` 5.103.1 | Fetch/cache GET, polling, abort, dedupe, mutation không retry |
| A11y gate | `@axe-core/playwright` 4.13.0 (dev) | Quét WCAG tự động trong browser tests |

Vẫn **không** thêm: router library, global state library, form library, animation library, CSS-in-JS, UI kit đóng gói sẵn theme (Mantine/MUI/Ant), remote fonts/CDN, persistence cho query cache.

## Vì sao đổi so với ADR-001

ADR-001 đo lock entries và gzip của một renderer tối thiểu. Các số đó đúng nhưng không đo yếu tố quyết định chất lượng của sản phẩm này:

1. **Accessibility tự viết.** V05 cần dialog xác nhận duyệt, tabs Kế hoạch/Tiến trình/Chứng cứ, disclosure payload, menu điều hướng mobile, thông báo trạng thái. Focus trap, trả focus, Esc, roving tabindex và ARIA đúng là phần dễ sai nhất khi tự viết bằng CSS/DOM thuần. Radix cung cấp các hành vi đó đã kiểm thử; WEB-03 vẫn phải kiểm lại trong browser.
2. **Token không được cưỡng chế.** CSS thuần cho phép literal màu/khoảng cách ở mọi nơi (shell WEB-01B đã có `#0b72b9` trực tiếp). Tailwind `@theme` biến token DESIGN.md thành tập class hợp lệ duy nhất; review có thể chặn arbitrary value.
3. **Không tái dùng được mockup.** Công cụ review trực quan (Claude Design, Google Stitch) xuất HTML + Tailwind. Với CSS thuần phải dịch lại từng màn.
4. **Polling/abort/stale response tự viết.** WEB-02B mô tả one-flight timer, abort theo generation, không để response cũ ghi đè. TanStack Query đã có: không chồng refetch cho cùng key, truyền `AbortSignal` vào `queryFn`, `refetchInterval` có điều kiện, hủy query khi unmount, `removeQueries/clear` khi đổi phiên.
5. **Không Fast Refresh.** Vòng chỉnh giao diện theo review trực quan cần giữ state khi sửa component.

Đây là nhận định thiết kế; chưa đo giờ phát triển hay lỗi thực tế. Chi phí đo được ở mục dưới.

## Căn cứ được đo

Nguồn: [measurement.json](web-evidence/ADR-002/measurement.json), tái chạy bằng `node docs/web-evidence/ADR-002/measure.mjs` từ root. Script tạo thư mục tạm, copy package manifests/lock hiện tại và ba file DSL thuần; `npm install --package-lock-only`, `npm ci --ignore-scripts`, `npm audit --json`, rồi `vite build` một mẫu. Lockfile workspace được kiểm hash không đổi.

| Biến thể | Lock entries | Tăng so 248 | JS mẫu, bytes | JS gzip | CSS gzip | `npm audit` |
|---|---:|---:|---:|---:|---:|---|
| Hiện tại (React + CSS thuần) | 248 | 0 | 323405 | 96422 | 77 | 0 vulnerability |
| Đề xuất ADR-002 | 373 | 125 | 441170 | 132840 | 1935 | 0 vulnerability |

- Mẫu hiện tại chỉ render nhãn; mẫu đề xuất dùng Dialog, Tabs, một query polling, icon, `cva` và `@theme`. **Không phải ứng dụng sáu view**, không đo focus, polling đúng hay tốc độ render.
- 125 lock entries gồm: 23 biến thể binary theo nền tảng (`@tailwindcss/oxide-*`, `lightningcss-*`, chỉ một biến thể được cài trên mỗi máy), 60 package `@radix-ui/*` do meta package `radix-ui` kéo vào, còn lại là Tailwind toolchain, TanStack Query, floating-ui, axe-core và tiện ích nhỏ. Chi tiết trong `added` của measurement.
- JS gzip tăng 36418 bytes. Gzip là phép nén offline, không phải network transfer đo được.
- `npm audit` phản ánh advisory database tại thời điểm chạy.

## Ràng buộc triển khai

1. **Pin exact** mọi version trong bảng; lock diff giải thích theo nhóm như trên; chạy `npm audit` và kiểm installed closure/policy fingerprint trước luồng MCP thật như ADR-001. Không nâng version chung với đợt thêm feature.
2. **Budget:** tổng JS tải ban đầu ≤ **200 KiB gzip** (thay 160 KiB của ADR-001, vì mẫu đã dùng 130 KiB), CSS ≤ 30 KiB gzip. Đây là ngưỡng review ở gate WEB-01C, chưa phải số đo ứng dụng. Vượt ngưỡng thì phân tích bundle và cân nhắc lazy-load view; không bỏ runtime Zod validation để giảm size.
3. **Tailwind v4:**
   - Token khai báo duy nhất trong `apps/web/src/app/theme.css` bằng `@theme`, sinh từ DESIGN.md. Không `tailwind.config.js` riêng.
   - Không dùng arbitrary value màu/spacing (`bg-[#...]`, `p-[13px]`) trong view/component; ngoại lệ phải có comment lý do và được review.
   - Không remote font; font stack hệ thống hoặc font tự host được DESIGN.md chốt, phải hiển thị đủ dấu tiếng Việt.
4. **shadcn/ui:**
   - Chạy CLI pinned `shadcn@4.21.0` trong lượt setup có review; commit `components.json` và mã sinh ra. CLI không phải dependency runtime và không chạy trong gate.
   - Mã trong `src/components/ui` là mã của repo: được sửa theo DESIGN.md, phải qua typecheck/lint/test như mã khác.
   - Chỉ thêm component khi một view cần; không import cả bộ.
   - Dùng meta package `radix-ui` như mặc định của shadcn để giảm sai lệch khi sinh mã. Phương án thay thế là các package `@radix-ui/react-*` riêng lẻ để giảm lock entries; chỉ đổi nếu review dependency yêu cầu.
5. **TanStack Query và ranh giới `core/`:**
   - `core/` vẫn không import React. Query options, query keys và `queryFn` gọi `Transport` được định nghĩa trong `core/queries.ts` bằng object thuần; React chỉ dùng hook `@tanstack/react-query` ở `app/`/views.
   - `Transport` vẫn là seam duy nhất gọi HTTP/fixture và parse Zod. Component không gọi `fetch`.
   - GET snapshot (history, run detail, servers, trace, reconciliation) dùng query. `refetchInterval` 2000 ms chỉ khi run chưa terminal hoặc chưa drain `run.finished`; `refetchOnWindowFocus` được phép vì chỉ là GET.
   - **Event stream theo `seq` không dùng cache Query làm authority:** `ingestEvents` thuần trong `core/events.ts` vẫn kiểm seq tăng chặt/gap/duplicate; query events chỉ là cơ chế lập lịch one-flight, đọc cursor từ state đã ingest và áp page nguyên tử. Kiểm thử của WEB-02B giữ nguyên yêu cầu.
   - Mutation (login, create run, approval decision, cancel) đặt **`retry: 0`**; mất phản hồi chuyển sang trạng thái “chưa xác nhận” rồi refetch GET, không gửi lại POST. Không `onMutate` optimistic update cho status/approval — server là authority.
   - Query key chứa `sessionGeneration`; khi login/logout/401/expiry gọi `queryClient.cancelQueries()` rồi `queryClient.clear()`. Không `persistQueryClient`, không devtools trong build production.
   - Default toàn cục: `retry` của query GET tối đa 2 với backoff, riêng 401/403/404/400 không retry.
6. **Fast Refresh:** chỉ dùng `@vitejs/plugin-react` không kèm Babel/React Compiler (peer optional không cài). Browser gate vẫn chạy bản build qua `vite preview`, không qua HMR.
7. **A11y:** `@axe-core/playwright` chạy trên mọi view và các trạng thái V05 chính trong WEB-03; không có violation mức serious/critical. Axe không thay kiểm bàn phím/screen reader thủ công.
8. Giữ nguyên từ ADR-001: hash routes với parser nhỏ, token memory-only, không `VITE_*` từ `.env` backend, local proxy guard, dev 5173/preview 4173 loopback, strictPort.

## Phạm vi, chi phí và khả năng đổi lại

- **Mã WEB-01B bị ảnh hưởng:** `src/app/App.tsx` (355 dòng) và `src/app/styles.css` (310 dòng) viết lại bằng component/Tailwind; `vite.config.ts` thêm hai plugin. Giữ `core/session.ts`, `core/navigation.ts`, `core/contracts.ts`, `core/fixtures.ts`, `tooling/local-proxy.ts` và unit tests. `core/store.ts` còn dùng cho session/event state; không dùng làm cache server.
- **Plan:** WEB-01C thêm bước setup Tailwind/shadcn/theme; WEB-02A/B/C thay controller tự viết cho GET/mutation bằng query options, giữ nguyên các kiểm thử hành vi (no-overlap, abort, stale, unknown outcome, không retry POST). Plan phải được sửa trước khi giao WEB-01C.
- **Ước lượng:** chưa đo lại. Kỳ vọng giảm công CSS/a11y ở WEB-01C và polling ở WEB-02B, đổi lại thêm thời gian setup và review mã sinh bởi shadcn. Hiệu chỉnh bằng giờ thực sau WEB-01C.
- **Đổi lại:** Tailwind/shadcn/Query nằm ở lớp view và adapter. `Transport`, Zod contracts, `ingestEvents`, session generation và engine không phụ thuộc chúng.

## Tài liệu liên quan

- [ADR-001](ADR-001-FRONTEND-STACK.md): renderer, proxy, bảo mật; phần styling/data layer được thay bởi ADR này.
- [System design](superpowers/specs/2026-09-15-platform-system-design.md) mục 8: module map frontend.
- [Kế hoạch WEB-01–03](superpowers/plans/2026-09-15-frontend-platform.md).
- [DESIGN.md](../DESIGN.md): nguồn token cho `@theme`.
- Tài liệu tham khảo: [Tailwind CSS v4 theme variables](https://tailwindcss.com/docs/theme), [shadcn/ui Vite](https://ui.shadcn.com/docs/installation/vite), [TanStack Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults), [Radix Primitives accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility).
