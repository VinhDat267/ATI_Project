# SLACK-02A · Hợp đồng Interface Kết nối Slack Cá nhân (@wap/tool-schemas)

**Trạng thái:** chờ triển khai  
**Nhánh gợi ý:** `feat/slack-02a-connection-contracts` · **Nền:** `fc12e3fb`  
**Vai trò sở hữu:** Integration / AI Engineer (chỉ sở hữu thư mục `packages/tool-schemas/`)  
**Phụ thuộc:** SLACK-01 (đã hoàn thành `myslack-context.ts` và `myslack-policy.ts`)  
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)  
**Kế hoạch chi tiết:** Task 1 trong [Kế hoạch SLACK-02](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md).

---

## 1. Mục tiêu và Phạm vi

Xây dựng các interface TypeScript và hàm xác thực runtime (validation) chuẩn tắc cho tầng kết nối cá nhân đa workspace và trạng thái chấp thuận tổ chức (consent). Cung cấp hợp đồng DTO bất biến để Backend (02B) và Frontend (02C) tiêu thụ an toàn mà không cần phụ thuộc vào mã triển khai nội bộ của nhau.

**Ranh giới nghiêm ngặt:**
- Chỉ tạo và chỉnh sửa file trong `packages/tool-schemas/`. Không đụng vào `apps/` hay `packages/tool-adapters/`.
- Tuyệt đối **không** đăng ký công cụ `myslack.*` vào `ALL_TOOLS`, `TOOL_MAP` hay `SERVICE_REGISTRY` (việc này dành cho SLACK-03).
- Không thêm dependencies mới vào `package.json`.

---

## 2. Chi Tiết File và Interface Cần Tạo

### 2.1. File Tạo Mới: `packages/tool-schemas/src/myslack-connection.ts`
Chứa các định nghĩa và hàm xác thực:
1. `type SlackConnectionStatus = 'active' | 'reconnect_required' | 'revoked';`
2. `type SlackConsentStatus = 'pending' | 'granted' | 'revoked';`
3. `interface SlackConnectionPublicInfo`:
   - `id: string;` (UUID kết nối nội bộ)
   - `workspaceId: string;` (Team ID, ví dụ `T12345`)
   - `workspaceName: string;`
   - `slackUserId: string;` (User ID, ví dụ `U12345`)
   - `slackUserLabel: string;` (Tên hiển thị / username)
   - `status: SlackConnectionStatus;`
   - `identityVersion: number;` (Số nguyên dương an toàn)
   - `scopes: string[];` (Tập hợp user scopes đã cấp)
   - `connectedAt: string;` (Chuỗi ISO-8601)
   - `consentStatus: SlackConsentStatus;`
   - `processingReady: boolean;` (Chỉ true khi `status === 'active'` VÀ toàn bộ điều kiện provider/evidence/retention trong policy đều thỏa mãn)
4. `interface SlackStartConnectionResponse`:
   - `url: string;` (URL chuyển hướng OAuth tới Slack)
5. `interface SlackCallbackResult`:
   - `connectionId: string;`
   - `workspaceId: string;`
   - `workspaceName: string;`
   - `slackUserId: string;`
   - `returnTo?: string;`
6. `interface SlackProcessingConsentInfo`:
   - `workspaceId: string;`
   - `status: SlackConsentStatus;`
   - `policyVersion: string;`
   - `providerId: string;`
   - `retentionDays: number;`
   - `authorizedBy: string;`
   - `evidenceRef: string;`
   - `grantedAt?: string;`
   - `revokedAt?: string;`
7. Các hàm xác thực runtime (ném `TypeError` khi dữ liệu rỗng, sai kiểu hoặc version ≤ 0):
   - `validateSlackConnectionPublicInfo(value: unknown): SlackConnectionPublicInfo`
   - `validateSlackProcessingConsentInfo(value: unknown): SlackProcessingConsentInfo`

### 2.2. File Cập Nhật: `packages/tool-schemas/src/index.ts`
- Export toàn bộ từ `./myslack-connection.js`.
- Đảm bảo `ALL_TOOLS`, `TOOL_MAP`, `SERVICE_REGISTRY` giữ nguyên không có `myslack`.

### 2.3. File Kiểm Thử: `packages/tool-schemas/tests/myslack-connection.test.ts`
- Kiểm tra tính bất biến của các interface và hàm xác thực.
- Kiểm tra chặt chẽ validation: từ chối ID rỗng, whitespace, version không an toàn (≤ 0, số thập phân, Infinity), retentionDays âm.
- Đảm bảo `ALL_TOOLS.some(t => t.service === 'myslack') === false`.
- Đảm bảo `SERVICE_REGISTRY.some(s => s.id === 'myslack') === false`.

---

## 3. Lộ Trình Thực Hiện TDD & Bằng Chứng Kiểm Thử

1. **RED:** Tạo `packages/tool-schemas/tests/myslack-connection.test.ts` với các ca kiểm thử validation và snapshot catalog. Chạy lệnh:
   ```sh
   npm test -w @wap/tool-schemas -- tests/myslack-connection.test.ts
   ```
   *Kỳ vọng:* Thất bại do chưa tồn tại module `myslack-connection.js`.
2. **GREEN:** Tạo `packages/tool-schemas/src/myslack-connection.ts`, export qua `packages/tool-schemas/src/index.ts`.
3. **VERIFY:** Chạy lại test:
   ```sh
   npm test -w @wap/tool-schemas -- tests/myslack-connection.test.ts
   npm run check:types
   ```
   *Kỳ vọng:* 100% tests PASS, typecheck đạt exit 0.
4. **COMMIT:** Chỉ commit các file trong `packages/tool-schemas/`:
   `feat(slack): add personal connection and consent schema contracts`

---

## 4. Tiêu Chí Nghiệm Thu
- [ ] Mọi interface DTO và type alias xuất phát từ `packages/tool-schemas`.
- [ ] Validation ném `TypeError` rõ ràng đối với payload không hợp lệ.
- [ ] Catalog `ALL_TOOLS` và `SERVICE_REGISTRY` giữ nguyên 100% không đổi.
- [ ] Không có circular dependencies, build sạch exit code 0.
