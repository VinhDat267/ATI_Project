# PL-10 · Kết nối Jira, Không gian làm việc và Dự án (Jira UI & Workspace Management)

**Trạng thái:** HOÀN THÀNH — ĐÃ DUYỆT ĐẠT (Argon High Round 2 PASS) · **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-10` · **Phụ thuộc:** PL-02, PL-08, PL-09 đã hoàn tất và được Argon High duyệt Đạt.  
**Base SHA:** `5b5df90e3413384ec71fb2afbf4bd0c6964c458c` (HEAD accepted của PL-09).  
**Accepted Head SHA:** `89deb95ce3de0f3708c3d07d7184c335b65f61b5`.  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md), [Design Brief v2.0](../../superpowers/specs/2026-11-05-planora-design-brief.md), [Business-First UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-10.  
**Báo cáo Review:** [2026-11-07-argon-review-pl-10.md](../log/2026-11-07-argon-review-pl-10.md).  
**Prompt thi công:** [PL-10.md](../planora-prompts/PL-10.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Thiết kế kết nối Jira theo nhu cầu làm việc với nhóm và dự án theo nhận diện Planora và tiêu chuẩn Business-First UX v2.0:
1. **Ngôn ngữ kết nối hướng công việc:** Trình bày rõ ràng: chọn kết nối, tham gia/tạo nhóm làm việc, xin quyền hạn và chọn dự án Jira dễ hiểu; không phơi bày các thuật ngữ kỹ thuật khô cứng như "9 tools/3LO/siteId". Tên site, project, issue key chỉ hiển thị khi giúp nhận diện công việc.
2. **Bảo toàn phân quyền & Hợp đồng kỹ thuật:** Giữ nguyên `JiraConnectionProps`, `selectedWorkspace`, API response/error và membership; vai trò trong workspace Jira (`admin` vs `member`) được quản lý độc lập, không tự suy ra từ global role.
3. **Bảo vệ chống Race Conditions & Phản hồi trễ:** Giữ nguyên các race guards khi đổi workspace/site/user giữa chừng, thông báo rõ ràng khi bị từ chối (`denied`), cần kết nối lại (`reconnect`), hết hạn (`expired`), danh sách rỗng (`empty`), hoặc mất mạng (`offline`).
4. **Tái sử dụng ConnectionCallbackFrame:** Tích hợp `ConnectionCallbackFrame` đã được chuẩn hóa ở PL-08 cho `JiraCallbackView`, đảm bảo presentation-only, không mutate OAuth state, không duplicate nút quay về Cài đặt, và đạt chuẩn tương pháo WCAG AA >= 4.5:1.
5. **Trợ năng & Tương phản:** Nút Primary dùng `var(--planora-primary)` và `var(--planora-on-primary)`, viền dùng `--planora-border-strong` và `--planora-divider`, 100% SVG vector icons có `aria-hidden="true"`, không còn emoji trần hoặc rác kỹ thuật "ATI".

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/Settings/JiraConnection.tsx`
  - Có thể tách panels UI trong `apps/chat-web/src/pages/Settings/jira/` nếu cần cấu trúc rõ ràng
  - `apps/chat-web/src/views/JiraCallbackView.tsx`
  - Tests jira liên quan trong `apps/chat-web/tests/`.
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-web/src/services/jira-api.ts` hay `jira-connection.ts` contract.
  - Không sửa `apps/chat-api` hay backend Jira endpoints.
  - Không sửa `ConnectionCallbackFrame.tsx` chung khi chưa có chỉ đạo từ coordinator.

---

## 3. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] JiraConnection được chuyển đổi sang CSS tokens Planora và copy Business-First (account identity, workspace list/create/join, site/project, pending request/admin approval).
- [x] Bảo toàn 100% role Jira workspace (không suy quyền Jira từ global role).
- [x] Tích hợp `ConnectionCallbackFrame` cho `JiraCallbackView` với WCAG AA contrast (Primary nút dùng `var(--planora-primary)` và `var(--planora-on-primary)`).
- [x] 100% SVG vector icons có `aria-hidden="true"`, không còn emoji trần hoặc rác kỹ thuật.
- [x] Toàn bộ test suite web PASS, `typecheck:v3` và `build:v3` exit code 0.

---

## 4. Kết quả thực hiện

- **Người thực hiện:** Gemini 3.8 Flash High (Antigravity worker).
- **Trạng thái:** HOÀN THÀNH — READY_FOR_CODEX_REVIEW.
- **Base SHA:** `5b5df90e3413384ec71fb2afbf4bd0c6964c458c`.
- **Target branch:** `codex/planora-ui`.
- **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-10`.

### 4.1. Chi tiết các tệp sửa đổi & tạo mới
1. `apps/chat-web/src/pages/Settings/JiraConnection.tsx`:
   - Chuyển đổi toàn bộ style sang CSS tokens Planora (`--planora-primary`, `--planora-on-primary`, `--planora-primary-hover`, `--planora-paper`, `--planora-surface-inset`, `--planora-text`, `--planora-muted`, `--planora-divider`, `--planora-border-strong`).
   - Loại bỏ hoàn toàn mã màu cam cũ `#FF5701` / `#E04C00`, thay bằng `var(--planora-primary)`.
   - Bổ sung `aria-hidden="true"` cho toàn bộ SVG vector icons.
   - Loại bỏ rác kỹ thuật copy "tổ chức ATI" và cập nhật thông báo ngắt kết nối theo nhận diện Planora.
   - Bảo toàn 100% logic phân quyền RBAC Jira workspace (admin vs member độc lập với global role), race condition guards, và khả năng cấu hình site/project.
2. `apps/chat-web/src/views/JiraCallbackView.tsx`:
   - Tích hợp chuẩn hóa `ConnectionCallbackFrame` presentation-only từ PL-08/PL-09.
   - Cung cấp tiêu đề `"Kết nối Jira"`, badge `"KẾT NỐI QUẢN LÝ DỰ ÁN"`, `statusType` và `statusLabel` động ('Đang xử lý' / 'Chưa kết nối').
   - Sử dụng callback `onBackToSettings` dẫn về `/settings#jira`, không duplicate thẻ `<a>` thủ công, đảm bảo WCAG AA >= 4.5:1.
3. `apps/chat-web/tests/jira-connection-responsive.test.tsx`:
   - Điều chỉnh query status in-flight để tương thích với cấu trúc của `ConnectionCallbackFrame` (`getAllByRole('status')`).
4. `apps/chat-web/tests/browser/jira-09a.spec.ts`:
   - Chuẩn hóa bộ chọn nút "Về Kết nối dịch vụ" chấp nhận cả button và link để tương thích với `ConnectionCallbackFrame`.
5. `apps/chat-web/tests/planora-pl-10-jira.test.tsx` (Tạo mới):
   - Bổ sung 6 test cases chuyên sâu kiểm thử:
     1. Khung `ConnectionCallbackFrame` presentation-only trong `JiraCallbackView`.
     2. A11y 100% SVG vector icons có `aria-hidden="true"`.
     3. Nút primary dùng token `var(--planora-primary)` và `var(--planora-on-primary)`, loại bỏ `#FF5701`.
     4. Loại bỏ triệt để chuỗi "ATI" trong copy hiển thị và modal ngắt kết nối.
     5. RBAC độc lập: Thành viên trong Jira workspace không được cấp quyền admin ngay cả khi có global role admin.
     6. Quyền quản trị Jira workspace được thực thi chính xác đối với thành viên có role admin trong workspace đó.

### 4.2. Bằng chứng kiểm thử & Nghiệm thu Review Độc lập
- **Round 1 Review (07/11/2026):** Argon High kết luận `CHƯA ĐẠT` với 2 findings P2 (F1: class CSS prototype cũ đè token Planora & 4 phân vùng con chưa chuyển đổi; F2: nhãn mờ, trạng thái và placeholder vi phạm tương phản WCAG AA) và 1 finding P3 (F3: thiếu `aria-label` trên select site, thiếu `disabled={busy}` trên nút Huỷ/Đóng và test SVG thiếu bao phủ nhánh lỗi).
- **Khắc phục Round 1 (Commit `64b9fa7c` & `89deb95c`):** Gemini 3.8 Flash High dọn sạch toàn bộ class prototype cũ, chuyển đổi toàn diện 4 phân vùng sang token Planora, chuẩn hóa semantic status tokens đạt WCAG AA ≥ 4.5:1 cả sáng/tối, bổ sung đầy đủ `aria-label` và `disabled={busy}` guard, mở rộng test SVG bao phủ lỗi kết nối và callback view.
- **Round 2 Re-Review (07/11/2026):** Argon High kết luận **ĐẠT (PASS)** trên HEAD `89deb95ce3de0f3708c3d07d7184c335b65f61b5`.
  - `npm run typecheck:v3`: Exit Code 0 (sạch 0 lỗi TypeScript).
  - `npm test -w @wap/chat-web -- jira`: Exit Code 0 (5 test files, 55/55 tests PASS).
  - `npm test -w @wap/chat-web`: Exit Code 0 (105/105 test files PASS, 1.192/1.192 tests PASS).
  - `npm run build:v3`: Exit Code 0 (Vite build production thành công, 200 modules transformed).
  - `node scripts/test-v3-web-build-security.mjs`: Exit Code 0.
  - 4/4 phép thử đột biến M1–M4 đều bị bắt FAIL thật sự.
