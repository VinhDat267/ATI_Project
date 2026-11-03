# Nhật ký thi công: Khắc phục Codex review finding Vòng 3 (C1) cho PL-03

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-03 · Landing, đăng nhập và đăng ký (Public & Auth)](../tasks/PL-03-planora-public-auth.md)
- **Worktree:** `feat-planora-pl-03`
- **Nhánh:** `longnguyen005/feat-planora-pl-03`
- **Reviewed Head SHA:** `5da40a118ab18ea73a3ddb1f284fd2f1e25fe381`
- **Base SHA:** `965150a9d80418d85354b7b3e8c6e8fff1fedd90`

---

## 1. Chi tiết Finding C1 từ Codex Review Vòng 3 & Giải pháp Triệt để

### C1 (P3) · Nút mở rộng Roadmap (“Xem chi tiết lộ trình 6 tháng”) chỉ cao 34.5px, vi phạm tap target 44px
- **Nguyên nhân cốt lõi:**
  - Nút `<button type="button" className="roadmap-toggle" ...>` trong `apps/chat-web/src/pages/Landing/LandingPage.tsx:931-940` điều khiển đóng/mở lộ trình 6 tháng của Planora.
  - Trong `apps/chat-web/src/pages/Landing/page.css:542-555`, `.roadmap-toggle` chỉ khai báo `padding: 8px 16px; font-size: var(--planora-text-xs);` mà không có ràng buộc `min-height`.
  - Kết quả: Chiều cao computed thực tế chỉ đạt ~34.5px (thiếu 9.5px so với chuẩn 44px quy định tại Mục 3 task card và WCAG 2.1 AA Target Size).
- **Khắc phục:**
  - Trong `apps/chat-web/src/pages/Landing/page.css`:
    ```css
    .roadmap-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      padding: 10px 18px;
      border-radius: var(--planora-radius-pill);
      border: 1px solid var(--planora-divider);
      background-color: var(--planora-paper);
      color: var(--planora-ink-primary);
      font-size: var(--planora-text-xs);
      font-weight: 500;
      cursor: pointer;
      box-sizing: border-box;
    }
    ```
  - Trong `apps/chat-web/tests/browser/planora-public.spec.ts`:
    - Bổ sung assertion kiểm tra vùng tương tác nút `.roadmap-toggle`:
      ```typescript
      const roadmapToggle = page.locator('.roadmap-toggle');
      await expect(roadmapToggle).toBeVisible();
      const roadmapBox = await roadmapToggle.boundingBox();
      expect(roadmapBox).not.toBeNull();
      expect(roadmapBox?.height).toBeGreaterThanOrEqual(44);
      ```
    - Bổ sung kiểm thử tương tác accordion: xác nhận trạng thái ban đầu ẩn `.roadmap-unfold`, click chuyển `aria-expanded="true"` và hiện nội dung, click lần 2 chuyển `aria-expanded="false"` và ẩn nội dung.

---

## 2. Bảng Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web sạch 100% lỗi TypeScript |
| `npm run build:v3` | **PASS (exit code 0)** | Vite production build thành công (193 modules) |
| `npm test -w @wap/chat-web` | **PASS (98/98 files, 1075/1075 tests, exit code 0)** | Toàn bộ 1075 unit/integration tests xanh |
| `git diff --check` | **PASS (exit code 0)** | Không có lỗi whitespace hay trailing spaces |

---

## 3. Danh sách File Sửa đổi

- `apps/chat-web/src/pages/Landing/page.css`
- `apps/chat-web/tests/browser/planora-public.spec.ts`
- `docs/handoff/tasks/PL-03-planora-public-auth.md`
- `docs/handoff/log/2026-11-03-gemini-pl-03-review-r3-fixes.md`
