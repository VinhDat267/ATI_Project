# ATI Project (Planora): quy tắc cho AI coding agent

Áp dụng cho mọi agent làm việc trong repo này (Codex, Antigravity, Claude Code, Cursor, Gemini CLI…). Nhóm vibe code 100%. Mục tiêu là **ship tính năng chạy được, nhỏ và an toàn**, không phải viết hồ sơ.

## 1. Bắt đầu một phiên (khoảng 2 phút)

1. Đọc [`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md): một trang về trạng thái từng dịch vụ và việc đang làm. Việc ưu tiên nằm ở [`docs/handoff/ROADMAP.md`](docs/handoff/ROADMAP.md).
2. `git fetch origin`. Làm trên nhánh mới tách từ `origin/main`. Nếu thư mục đang có thay đổi chưa commit không phải của bạn, tạo `git worktree` riêng, không chuyển nhánh của người khác.
3. Cần chi tiết lịch sử thì xem `git log`, mô tả PR trên GitHub, hoặc `docs/archive/`. **Không bắt buộc đọc.**

## 2. Mã nguồn ở đâu

`packages/tool-schemas/` · `packages/tool-adapters/` · `packages/planner/` · `packages/executor/` · `apps/chat-api/` · `apps/chat-web/` · `db/v3/` · `prompts/` · `evaluations/`.

- Một tính năng được phép sửa xuyên các package (schema → adapter → API → web) trong cùng một PR.
- Mã v1/v2 đã xoá; ảnh chụp nằm ở tag `archive/v2-final`. Không khôi phục vào `main`.
- Hành vi nghiệp vụ chuẩn: [đặc tả v3](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md). Chỉ tra khi cần.

## 3. Bất biến an toàn của sản phẩm (không được phá)

1. Mọi lệnh ghi ra dịch vụ ngoài phải qua **preview và người dùng duyệt** (`plan_hash`). Không có đường tắt.
2. Kết quả gửi hoặc ghi **chưa rõ (`unknown`) thì không tự chạy lại**. Chuyển `needs_attention` để người xử lý.
3. Adapter chỉ chạm tài nguyên trong **allowlist/phạm vi đã chọn**. Credential cá nhân hay tổ chức phải đúng ngữ cảnh workspace.
4. **Không commit secret** (token, mật khẩu, `.env`, dữ liệu thật của người dùng).
5. Migration DB chỉ thêm, chạy lại được (idempotent). Không sửa migration đã merge.

## 4. Test

- Có test cho hành vi bạn thêm hoặc sửa. Sửa bug thì có test tái hiện bug.
- Logic DB, khóa hoặc đồng thời: test trên PostgreSQL thật (`DATABASE_URL`). Timeout: test bằng `AbortSignal` thật. Không mock hình thức kiểu `let approved = true`.
- Trước khi mở PR: chạy test của phần mình sửa và `npm run typecheck:v3`. **Toàn bộ suite giao cho CI**, không bắt buộc chạy `npm run check` đầy đủ ở máy.
- Đổi prompt hoặc planner: ghi rõ đã chạy golden set với model thật hay chưa.

## 5. Ship

1. Nhánh `feat|fix|chore|docs/<tên-ngắn>`, commit theo Conventional Commits.
2. Chỉ `git add` file của việc mình làm (không dùng `git add -A`).
3. Mở PR theo mẫu: **Làm gì / Vì sao / Đã test gì**. Không có chữ ký "Generated with…".
4. **CI xanh thì merge.** CI đỏ vì test chập chờn hoặc vì PR khác thì báo trong PR, sửa ở chỗ gây lỗi.
5. Nếu PR làm thay đổi trạng thái một dịch vụ, sửa **dòng tương ứng** trong `CURRENT-STATE.md` ngay trong PR đó. Không mở PR riêng chỉ để ghi sổ.

**Nhờ agent khác review diff trước khi merge** khi PR đụng vào: migration DB, OAuth/token, luồng gửi hoặc ghi ra dịch vụ thật, xoá dữ liệu, hoặc CI. Các PR khác không bắt buộc review. Checklist ngắn ở [`docs/handoff/REVIEW-CHECKLIST.md`](docs/handoff/REVIEW-CHECKLIST.md).

## 6. Không làm

- Không viết task card, log, báo cáo audit hay bộ bằng chứng nếu không được yêu cầu. Mô tả PR là đủ.
- Không mở rộng phạm vi ngoài việc được giao. Thấy lỗi khác thì ghi vào `ROADMAP.md` hoặc báo lại.
- Không push thẳng `main`, không `--force` lên nhánh chung, không `--no-verify`.
