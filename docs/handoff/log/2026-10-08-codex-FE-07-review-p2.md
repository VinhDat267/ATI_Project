# FE-07 — Sửa P2 sau review độc lập

08/10/2026 · Codex · PR [#108](https://github.com/VinhDat267/ATI_Project/pull/108) · **chờ Claude Code review lại phần sửa; chưa merge**.

## Review và phạm vi

Đã đọc đầy đủ [bình luận review của Claude Code](https://github.com/VinhDat267/ATI_Project/pull/108#issuecomment-6056958988) trên head `003719c`: “Đạt sau khi sửa nhỏ”, 1 P2 chặn merge, không có P1. Reviewer đã chạy check/browser và mutation, xem ảnh. Đây là bằng chứng của reviewer, không nhận là lượt chạy của Codex.

P2 xác nhận được: trước khi GET /api/services có danh mục, UI vẫn hiện tổng 0/8 và hai câu trống, trong đó “Tất cả 8 dịch vụ đều đã được thiết lập.” sai sự thật. Vi phạm đặc tả 1.1.2/6.

Đã đọc lại AGENTS, README/CURRENT-STATE và 3 log mới nhất (FE-07, stabilize-flaky-tests, remove-system-design-v2), kiểm Git. Tiếp tục worktree/nhánh FE-07 sạch của phiên trước. origin/main vẫn `eb48f0b`. Không sửa file của agent khác hoặc CURRENT-STATE/ROADMAP.

## Sửa

Commit mã **658420c3725bc737a843459c93a1e685723eee7a**:

- `apps/chat-web/src/pages/Settings/SettingsPage.tsx`: chỉ dựng tóm tắt và hai nhóm khi `list.length > 0`. Khi chưa có danh mục chỉ hiện trạng thái tải hoặc lỗi/Thử lại. Nếu đã có danh mục từ lần tải thành công thì tiếp tục dùng dữ liệu đó, kể cả refresh lỗi.
- `apps/chat-web/tests/fe-07-settings.test.tsx`: thêm 2 ca HTTP loopback thật: giữ response GET đầu tiên chưa trả và trả HTTP503. Cả hai bắt không được xuất hiện số liệu/câu trống giả, đồng thời chứng minh dữ liệu xuất hiện sau khi response được trả hoặc Thử lại thành công.
- Không đổi class, CSS, layout của trạng thái đã có dữ liệu; không đổi API/save/scope/check, quyền, focus hay hash.

## TDD và kiểm chứng

Evidence ngoài repo: `C:/Users/VinhDat/.codex/fe07-evidence/`.

| Kiểm tra | Output | Exit |
|---|---|---|
| RED trước sửa: npm run test -w @wap/chat-web -- tests/fe-07-settings.test.tsx -t 'does not claim catalogue' | 2 failed, 22 skipped (24); cả hai bắt câu “Tất cả 8 dịch vụ…” còn xuất hiện | 1 |
| GREEN focused: FE-07 + settings + settings-page + service-credential-draft | 4 files, 46 passed | 0 |
| npm run check | 47 + 340 + 196 + 25 + 349 + 499 = 1.456 v3; 165 eval; typecheck/build; launcher 1; fixture/guard 10 | 0 |
| npm run test:browser:v3 | 52 + 2 + 5 + 2 + 2 + 6 = 69 passed qua 11 scenario | 0 |
| Browser fault injection / 8 ảnh | loading/error không có số liệu/câu trống giả; release/retry hồi phục; overflow=0 | 0 |
| git diff --check | không lỗi khoảng trắng | 0 |

Log: `review-p2-red-confirmed.txt`, `review-p2-focused-green.txt`, `review-p2-check.txt`, `review-p2-browser.txt`, `review-p2-capture.txt`. Lượt RED đầu (`review-p2-red.txt`) có một assertion sai về chữ lỗi raw “offline”; API client trình bày lỗi mạng bằng tiếng Việt. Đã sửa test theo thông báo thực tế, chạy lại RED-confirmed **trước khi sửa mã sản phẩm**; cả hai fail đúng P2. Check/browser cuối đạt ngay lượt đầu, không retry.

DB PostgreSQL16 tmpfs riêng `ati-fe07-pg`, DB55536/API3006/web5186, sandbox; migrate/provision theo v3-check.yml. Không dùng DB15433. Sau kiểm chứng đã dừng đúng launcher/children do phiên này tạo, xoá đúng container tmpfs của FE-07; các cổng riêng đều đóng, worktree giữ lại. Thay đổi của người dùng ở main (.gitignore, PRODUCT.md, docs/reports/, skills-lock.json) nguyên trạng.

## Ảnh bổ sung và SHA256

8 PNG 1440×900/375×812, sáng/tối, admin, loading/error, đã xem đủ 8. Browser dùng đăng nhập và danh mục từ API/PostgreSQL thật; loading trì hoãn việc giao response thật về trình duyệt, error huỷ request mạng. Không chèn số liệu catalogue giả. Mỗi trường hợp đều kiểm retry/release lấy lại danh mục.

Ảnh ngoài repo tại `C:/Users/VinhDat/.codex/fe07-evidence/review-p2-visual/`; helper `capture-review-p2.cjs` cũng ngoài repo. Không commit ảnh. Không chụp lại bộ 256 ảnh trước review vì delta không đổi markup/class/CSS của trạng thái đã có danh mục; ảnh bổ sung chứng minh hai trạng thái dữ liệu chưa biết theo quy tắc trung thực 1.1/6.

| File | SHA256 |
|---|---|
| p2-1440-dark-error.png | `94e90941baf1ada53138cc89a55aede1e46e361e0ec2791071bc1e8e9627e971` |
| p2-1440-dark-loading.png | `a5c586e5d2b7b413284e45e32bd7c3942e89418b0cb521c7589ae8548ffb8048` |
| p2-1440-light-error.png | `0eca624cc2ead5b603854832a927283997071035eaae7cd71a6573b4f4609c03` |
| p2-1440-light-loading.png | `ff83a6594d1dd5df956cd8c1c0470cc2ebc712bb920851250079087d80bdc5de` |
| p2-375-dark-error.png | `5240840d5d936ed2c84165334be9058d0b6d409461e9e12d164b155fe2a45b6c` |
| p2-375-dark-loading.png | `b9745bba6b0f43665d88a28ae71c746f94bc323f908f3ec876eb4b069145f1b8` |
| p2-375-light-error.png | `297b2c398a5e3581452d65e2707415736b2e26ed0e5debd679dd2c368480c722` |
| p2-375-light-loading.png | `a1a8484473f411e38d9718052d7fa99d5bcfb4e511a9eac0ef30a4698cb52844` |

## P3 và giới hạn

Năm P3 theo review, chưa sửa trong delta này, không chặn merge:
1. Placeholder Site URL/email nên theo loại trường.
2. Quyền sửa theo role khác allowlist SERVICE_ADMIN_USER_IDS ở backend; cần API trả capability trong task riêng.
3. ServiceCard chỉ còn test dùng; dọn component/test riêng ở task dọn dẹp.
4. list chứa button thiếu listitem, thừa hưởng source; có thể sửa semantics không đổi hình thức.
5. Browser Notion dùng provider thật/token giả và ca member phụ thuộc seed của ca admin; cần tách fixture/giảm phụ thuộc mạng.

Reviewer còn ghi AUTH-01 logout-all chập chờn (lượt review đầu lỗi, lượt sau toàn bộ xanh). Ghi nhận ở đây để reviewer bổ sung backlog, không sửa CURRENT-STATE/ROADMAP hoặc test auth trong FE-07.

Giữ giới hạn cũ: provider healthy/khoá thật và ghi dịch vụ thật, screen reader, nghiệm thu sản phẩm vẫn NOT_RUN. Claude Code đã review nền 003719c; review delta P2 và merge vẫn chờ. Không tự merge.
