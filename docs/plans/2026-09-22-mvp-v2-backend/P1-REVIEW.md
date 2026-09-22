# Báo cáo Rà soát Độc lập Giai đoạn P1 (Foundation & Contracts)

**Dự án:** AI Automation Platform (MVP v2)  
**Mục tiêu:** Nghiệm thu kỹ thuật và rà soát độc lập toàn bộ mã nguồn, schema và migration CSDL thuộc Giai đoạn P1 (Tasks `BE-01` đến `BE-07`).  
**Ngày rà soát:** 22/09/2026  
**Trạng thái kết luận:** **PASS — ĐẠT 100% TIÊU CHUẨN KỸ THUẬT VÀ HỢP ĐỒNG**

---

## 1. Tóm tắt kết quả (Executive Summary)

Đã hoàn thành rà soát độc lập chuyên sâu theo 4 trụ cột kỹ thuật đối với 7 module mã nguồn, 2 file migration PostgreSQL và 5 bộ suite kiểm thử (36 unit tests) của Giai đoạn P1:
- **BE-01:** `identity.ts` — Stable Source & Create Intent Key
- **BE-02:** `source.ts` — Bounded Source Parser
- **BE-03:** `policy.ts` — Exact Resource Authorization Primitive
- **BE-04:** `checklist.ts` — Checklist Model & Source Revision Hash
- **BE-05:** `0010_pilot_source_snapshot.sql` — DB Migration cho Run Profile & Source Snapshot
- **BE-06:** `0011_business_reservations.sql` — DB Migration cho Business Reservation & Deduplication
- **BE-07:** `schemas.ts` — Zod Schemas cho Profile, Snapshot, Reservation, Receipt

**Kết quả tổng quan:**
- **0** lỗi `CRITICAL` (Không vi phạm bất kỳ invariant nào của [EXECUTION-CONTRACT.md](../../EXECUTION-CONTRACT.md)).
- **0** lỗi `HIGH` (Không có rủi ro rò rỉ credential, ReDoS hoặc tràn bộ nhớ).
- **0** lỗi `MEDIUM` (Cấu trúc dữ liệu, kiểu TypeScript và ràng buộc CSDL đạt chuẩn tối ưu).
- Toàn bộ **36/36 unit tests** của P1 đều PASS với các ca biên đầy đủ.
- Toàn bộ suite **414 unit tests** của `@wap/engine` PASS, xác nhận **0 regression**.
- Lệnh `npm run typecheck` đạt exit code `0` (sạch lỗi kiểu).

---

## 2. Chi tiết đánh giá theo 4 Trụ cột

### Trụ cột 1: Tuân thủ Hợp đồng thực thi & Quy tắc bất biến (Contract Invariants)

| Hạng mục rà soát | File kiểm tra | Bằng chứng & Đánh giá mã nguồn | Kết luận |
|---|---|---|---|
| **Chống trùng xuyên run/operator** | `packages/engine/src/pilot/identity.ts` | `createIntentKey` được tính toán qua SHA-256 từ `['pilot-create-1', sourceKey(i), boardId, 'create_card']`. **Tuyệt đối không chứa** `runId`, `operatorId`, `rowNumber` hay `sourceRevision`. JSON array serialization loại bỏ hoàn toàn nguy cơ delimiter aliasing. Định danh rỗng hoặc chứa khoảng trắng thừa bị từ chối với `INVALID_ID`. | **PASS** |
| **Giới hạn nguồn đọc (Bounded Intake)** | `packages/engine/src/pilot/source.ts` | Parser áp dụng thứ tự kiểm tra nghiêm ngặt: độ dài mảng ngoài (`> 101` ném `ROW_LIMIT`) → đối chiếu 8 tiêu đề cố định (`HEADERS`) → độ rộng hàng (`> 8` ném `EXTRA_COLUMNS`) → kiểu ô (`CELL_TYPE`, không ép kiểu số tự động) → đếm ký tự code points (`> 16000` ném `TEXT_LIMIT`). Phát hiện trùng ID trên toàn bảng (`DUPLICATE_ID`). Formula `=...` được giữ nguyên dưới dạng text trơ. | **PASS** |
| **Phân quyền tài nguyên Fail-closed** | `packages/engine/src/pilot/policy.ts` | Hàm `assertPilotAccess` kiểm tra cờ `enabled`, `principalId` hợp lệ và so khớp chính xác cả `spreadsheetId + tabId` (cho Sheet) và `boardId` (cho Trello). Từ chối tên nhãn. Thông báo lỗi duy nhất là `ACCESS_DENIED`, không làm lộ bất kỳ dữ liệu nhạy cảm hay thông tin cấu hình nào. | **PASS** |
| **Tách biệt nghiệp vụ & Phê duyệt kỹ thuật** | `packages/engine/src/pilot/checklist.ts` | Phân định rõ `decision_status` (xác nhận nghiệp vụ của khách) và approval kỹ thuật của platform. Nếu `decision_status` chưa xác nhận thì cờ `unconfirmedBusiness = true` và checklist trả về `needs_input`. Kiểm tra chuẩn ngày Gregory `YYYY-MM-DD` bao gồm cả năm nhuận (bắt lỗi "thứ Sáu"). `computeSourceRevision` nhạy cảm với mọi thay đổi dữ liệu. | **PASS** |

### Trụ cột 2: Phân tích An toàn & Bảo mật (Security & Reliability)

- **Credential Boundary:** Không có bất kỳ secret, API key hay private key nào được hardcode hoặc yêu cầu trong các module P1. Tất cả tham số đều là các định danh trừu tượng (`principalId`, `spreadsheetId`, `tabId`, `boardId`).
- **Khả năng chống ReDoS (Catastrophic Backtracking):**
  - Regex ngày tháng: `/^(\d{4})-(\d{2})-(\d{2})$/` — Thời gian tuyến tính `O(N)`, không có quantifier lồng nhau.
  - Regex nhận diện URL: `/https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*|\/[a-zA-Z0-9_#-]+/i` — An toàn, không có chu trình đệ quy lồng nhau.
  - Regex kích thước: `/\b\d+\s*[xX*×]\s*\d+\b|\b\d+\s*(?:px|in|cm|mm|pt)\b|\b\d+:\d+\b/i` — Các quantifier có giới hạn số, không gây ReDoS trên chuỗi 16.000 ký tự.
- **Xử lý Unicode Code Points:** Trong `source.ts`, vòng lặp `for (const _character of cell)` sử dụng string iterator chuẩn của JavaScript/V8, xử lý chính xác các cặp mã đại diện (surrogate pairs / emoji đa byte), bảo đảm đếm đúng số code points thực tế mà không gây lỗi cắt ngang ký tự.

### Trụ cột 3: Toàn vẹn Cơ sở dữ liệu (Migrations 0010 & 0011)

- **0010_pilot_source_snapshot.sql:**
  - Bổ sung cột `profile TEXT NOT NULL DEFAULT 'b-local'` trên bảng `runs`: Additive và an toàn cho toàn bộ dữ liệu lịch sử.
  - Bảng `source_snapshots`: Ràng buộc khóa ngoại `run_id REFERENCES runs(id) ON DELETE CASCADE` bảo đảm toàn vẹn tham chiếu.
  - Chỉ mục: `source_snapshots_run_idx` trên `run_id` (phục vụ truy vấn chi tiết run) và `source_snapshots_key_rev_idx` trên `(source_key, source_revision)` (phục vụ đối chiếu preflight nhanh).
  - Bảng `pilot_profiles`: Khóa chính `id`, trigger tự động cập nhật `touch_updated_at()`.
- **0011_business_reservations.sql:**
  - Bảng `business_reservations`: Ràng buộc `intent_key TEXT NOT NULL UNIQUE` bảo đảm mức CSDL không thể có 2 bản ghi cùng khóa intent.
  - Ràng buộc trạng thái: `CHECK (status IN ('reserved', 'dispatched', 'confirmed', 'unknown', 'cancelled'))`.
  - Chỉ mục: `business_reservations_source_idx`, `business_reservations_status_idx`, `business_reservations_run_idx`.
  - Trigger `touch_updated_at()` được đăng ký đầy đủ.
- **Tính tương thích Migration Runner:** Cả 2 file tuân thủ định dạng tên `^\d{4}_[a-z0-9_]+\.sql$`, lệnh `npm run build -w @wap/db` biên dịch thành công 100%.

### Trụ cột 4: Chất lượng Kiểm thử & Độ bền Đột biến (Test Rigor & Mutation)

- **Độ bao phủ:** 5 test suites bao phủ đầy đủ 36 trường hợp kiểm thử cho P1.
- **Kiểm tra ca biên (Edge cases):**
  - Đã kiểm tra chính xác 100 hàng (hợp lệ) và 101 hàng dữ liệu (`ROW_LIMIT`).
  - Đã kiểm tra chính xác 16.000 code points (hợp lệ) và 16.001 code points (`TEXT_LIMIT`).
  - Đã kiểm tra ngày nhuận (2024-02-29 hợp lệ, 2023-02-29 không hợp lệ).
  - Đã kiểm tra hàng trống và cột thừa (`EXTRA_COLUMNS`).
- **Thực nghiệm Mutation Probes:**
  - *Probe 1:* Cố tình bỏ `sourceKey(i)` trong `createIntentKey` → Test suite phát hiện ngay lập tức và chuyển RED tại `tests/pilot-identity.test.ts:147`.
  - *Probe 2:* Cố tình nới lỏng giới hạn hàng trong `source.ts` từ 101 lên 102 → Test suite phát hiện ngay tại `tests/pilot-source.test.ts:220`.
  - *Probe 3:* Cố tình cho phép ô số trong `source.ts` → Test suite phát hiện ngay tại `tests/pilot-source.test.ts:231`.

---

## 3. Ma trận đối chiếu Hợp đồng (Traceability Matrix)

| Yêu cầu trong Hợp đồng thực thi | Module triển khai | Unit Test chứng thực | Đánh giá |
|---|---|---|---|
| **V2-FR-01 / V2 Invariant 1:** Bounded source parsing, schema strict, revision hash | `source.ts`, `checklist.ts` | `pilot-source.test.ts` (11 tests), `pilot-checklist.test.ts` (8 tests) | **TUÂN THỦ** |
| **V2 Invariant 2:** Tách biệt xác nhận nghiệp vụ và platform approval | `checklist.ts`, `schemas.ts` | `pilot-checklist.test.ts:85`, `pilot-schemas.test.ts:20` | **TUÂN THỦ** |
| **V2-FR-05 / V2 Invariant 3:** Business intent key xuyên run, không chứa `runId`/`sourceRevision` | `identity.ts`, `0011_business_reservations.sql` | `pilot-identity.test.ts:150` | **TUÂN THỦ** |
| **V2-FR-08 / V2 Invariant 4:** Kiểm soát bảo mật fail-closed, không rò rỉ credential | `policy.ts`, `schemas.ts` | `pilot-policy.test.ts:21` | **TUÂN THỦ** |
| **V2-FR-07:** Phân quyền Principal, quản lý cấu hình Pilot đóng | `policy.ts`, `0010_pilot_source_snapshot.sql` | `pilot-policy.test.ts:12`, `pilot-schemas.test.ts:10` | **TUÂN THỦ** |

---

## 4. Kết luận & Đề xuất tiếp theo

Giai đoạn P1 đã hoàn thành xuất sắc và đáp ứng trọn vẹn mọi tiêu chuẩn khắt khe của dự án. Không có bất kỳ thiếu sót cấu trúc hay vi phạm hợp đồng nào tồn đọng.

**Đề xuất hành động:**
1. Khóa chính thức Gate P1 với kết luận `PASS`.
2. Giữ nguyên tính bất biến của các module P1 trong các giai đoạn tiếp theo.
3. Sẵn sàng tiếp tục giai đoạn P3 (Source-Aware AI & Pilot API) trên nền tảng P1 + P2 đã được rà soát và kiểm chứng vững chắc.
