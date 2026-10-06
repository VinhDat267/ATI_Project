# PROTO-01 · Chuyển 12 bản mẫu HTML sang React, giữ nguyên design system

**Trạng thái:** bước 1 xong (chờ review/merge), bước 2–4 chờ · **Nhánh bước 1:** `feat/proto-react-01` · **Phụ thuộc:** không
**Người yêu cầu:** chủ dự án, 06/10/2026 · **Thi công bước 1:** Claude Code (theo yêu cầu trực tiếp của người dùng)

## Vì sao

Người dùng muốn có bản React của 12 bản mẫu trong `docs/design/prototypes/` trước khi đưa vào app, dùng đúng công nghệ của `apps/chat-web`. Design system của 12 bản mẫu đã đồng nhất và được giữ nguyên: màu, font, bóng, cỡ chữ (kể cả chữ 10–12px), dữ liệu mẫu, nút demo.

## Phạm vi

- Chỉ trong `docs/design/prototypes/react/`. Không sửa `apps/chat-web`, không sửa 12 file HTML gốc.
- Không thêm gói npm: dùng React 19.3, Vite 8.3, Tailwind 4.3.3, TypeScript ở `node_modules` gốc.
- Mỗi trang phải khớp bản gốc theo `npm run verify`: từng phần tử (thẻ, class, vị trí, khoảng 60 thuộc tính computed style, chữ) và từng pixel, ở 1440×900 và 375×812, sáng và tối.

## Các bước

1. **Khung, công cụ, hai trang thử:**
   - bộ chuyển HTML → JSX, lớp tương thích Tailwind v3 → v4, token theo trang;
   - nút Sáng/Tối, điều hướng, script so;
   - trang `404` và `privacy`.
2. `errors`, `responses`, `auth-action`.
3. `account`, `users`, `settings`, `history`, `guide`.
4. `index` và `app-stage`. JS nhiều nhất (750 và 1.109 dòng): cuộn kể chuyện, 9 khoảnh khắc, ngăn kéo. Script so cần thêm kịch bản thao tác.

## Tiêu chí nghiệm thu (mỗi bước)

- [ ] `npm run verify -- <các trang của bước>` exit 0: 0 phần tử lệch, 0 pixel lệch, không lỗi console ở bản React.
- [ ] Hành vi của bản mẫu (nút, form, ngăn kéo, demo) viết lại bằng state React; không còn lời gọi `todo()`.
- [ ] `npm run typecheck` và `npm run build` exit 0.
- [ ] Từ bước 2: trang có thao tác thì script so thêm kịch bản thao tác và so trạng thái sau thao tác.

## Ngoài phạm vi, cần chốt sau

Đưa bản React vào `apps/chat-web`. Khi làm, design system của bản mẫu sẽ mâu thuẫn với:
- đặc tả giao diện mục 1.1 (chữ tối thiểu 14px, tiêu đề tối đa 40px, token màu của app, nền `#F6F6F1`);
- token của FE-04.

Người dùng đã nói muốn giữ design system của bản mẫu; cần sửa đặc tả trước khi tích hợp.

## Kết quả bước 1 (Claude Code, 06/10/2026)

**Đã làm** (`docs/design/prototypes/react/`):
- `scripts/html-to-jsx.mjs`, `gen-tokens.mjs`, `extract-v3-palette.mjs`, `verify-parity.mjs`;
- `src/styles/` (token 12 trang, 242 màu v3, lớp tương thích);
- `src/app/` (theme, nút Sáng/Tối, CSS theo trang, router);
- trang `NotFound` và `Privacy`;
- `README.md` giải thích cách chạy và từng điểm tương thích.

**RED → GREEN** bằng `node scripts/verify-parity.mjs 404 privacy`:

| Lần chạy | Kết quả | Lệch tìm thấy |
|---|---|---|
| 1 (khung + markup sinh tự động) | 8/8 lệch; cấu trúc khớp 47/47 và 283/283 phần tử | `space-y` đặt margin sai phía; `rounded-full` khác số; privacy 1440 cao hơn 77px (`leading-*` thắng `text-*` qua `--tw-leading`); 404 chưa có JS |
| 2 | 404 đạt 4/4 | privacy còn `line-height` 46,67px so với 40px: v4 lưu `line-height` của `text-*` dạng tỉ lệ |
| 3 | privacy 0 phần tử lệch | 349–1.385 pixel lệch: khoảng trắng đầu text bị tách thành text node riêng, chữ lệch lẻ pixel |
| 4 | **8/8 ĐẠT**, exit 0 | 404 (47 phần tử) và privacy (283 phần tử, ảnh 1440×4414 và 375×6868) không lệch phần tử nào, không lệch pixel nào |

**Kiểm tra khác:**
- **Hành vi** (Playwright, script tạm), 8/8 đạt:
  - một nút Sáng/Tối; bấm thì sang tối, lưu `ati-theme`, cập nhật `aria-pressed`/`aria-label`, có thông báo cho trình đọc màn hình;
  - link nội bộ đổi trang không tải lại, gỡ CSS và class của trang cũ;
  - 404 hiện đường dẫn lạ kèm query; "Quay lại trang trước" chạy đúng;
  - không lỗi console.
- `npm run typecheck` exit 0; `npm run build` exit 0 (CSS 34,93 kB, JS 286,55 kB). Trong bản build, link CSS đứng sau mốc chèn CSS của trang.

**Giới hạn:**
- Script so trạng thái mở trang. Thao tác chỉ kiểm bằng script tạm ở trên.
- Bản gốc được nạp thêm đủ font khi so (README giải thích).
- Script so cần mạng.
- `parse5` dùng qua phụ thuộc của `jsdom` ở `node_modules` gốc.
