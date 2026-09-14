# Đính chính mã băm tệp cài đặt FS-01 (Provenance Hash Correction)

**Thời điểm ghi nhận:** Phát hiện qua kiểm toán độc lập của Codex 2026-09-14T05:03:11Z; artifact sinh tự động tại thời điểm ghi trong [candidate-artifact.json](candidate-artifact.json)  
**Phạm vi:** Báo cáo FS-01 (Mục 7 về mã băm của 7 tệp thuộc package `@modelcontextprotocol/server-filesystem@2026.8.31`)  
**Tệp artifact sinh tự động:** [candidate-artifact.json](candidate-artifact.json)  
**Baseline tham chiếu:** [filesystem-handoff-baseline.json](../../../antigravity/filesystem-handoff-baseline.json)

---

## 1. Lý do đính chính

Trong văn bản báo cáo FS-01 ban đầu (`docs/task-hub-evidence/batch-02/FS-01/FS-01.md`, Mục 7), 7 giá trị mã băm SHA-256 của các tệp đã cài đặt được ghi nhận sai lệch so với tệp thực tế trên ổ đĩa; nguyên nhân chính xác của sự sai lệch văn bản này chưa được xác định.

Qua kiểm toán độc lập của Codex (Finding R6 trong `docs/task-hub-evidence/batch-02/review-FS-01-20260914/README.md`) và xác minh bằng script `scripts/emit-candidate-artifact.mjs`, **tất cả 7 tệp thực tế của package `@modelcontextprotocol/server-filesystem@2026.8.31` cài đặt trong `node_modules` đều khớp 100% với baseline `candidate_review.files_sha256`**. Hoàn toàn không có hiện tượng package bị sửa đổi hay thay thế; sai lệch nằm ở văn bản báo cáo thủ công.

---

## 2. Bảng đối chiếu chi tiết 7 tệp

| Đường dẫn tệp (trong package) | Giá trị in sai trong báo cáo cũ | Mã băm thực tế trên ổ đĩa (SHA-256) | Mã băm kỳ vọng trong Baseline | Kết quả đối chiếu |
|---|---|---|---|---|
| `dist/index.js` | `729dc851eb3c4c9545ce1e6798b030fb41d13db982ff4c575a7fc4d97fdf45ae` | `729dc8511e779e5cd6640851a74b25283e3af1ca3a7106722f993e864a1d9935` | `729dc8511e779e5cd6640851a74b25283e3af1ca3a7106722f993e864a1d9935` | **KHỚP 100%** |
| `dist/lib.js` | `e8713c8c7f3e8b0a9cb34b41b997970d47d4e3cb484c66e92789114d59a88241` | `e8713c8cfa0c4f49623fc38d61696fb607ec73e1966d51462b470a7717ca7948` | `e8713c8cfa0c4f49623fc38d61696fb607ec73e1966d51462b470a7717ca7948` | **KHỚP 100%** |
| `dist/path-utils.js` | `2129214ed03ba551e18d09559c5a2c4e12e3ffb990ff5b095efbe21ce2cbe7f8` | `2129214ece0aa7ee51a0e7d615bfdd9266c7284d8d5ecf02aff07d0a2c3dacd1` | `2129214ece0aa7ee51a0e7d615bfdd9266c7284d8d5ecf02aff07d0a2c3dacd1` | **KHỚP 100%** |
| `dist/path-validation.js` | `c2d5481ed73d1f8f0ba6503c40a7cf5bf4a434c44e99f09f03222be7ea3e12be` | `c2d5481e236814c3a4f32c74580f03fb19b25ff7d0b743cf9d51555c9399d9b6` | `c2d5481e236814c3a4f32c74580f03fb19b25ff7d0b743cf9d51555c9399d9b6` | **KHỚP 100%** |
| `dist/roots-utils.js` | `4074f48ad4a6ba5ffb618ee314d334547926b48450c2fa97d81a96752da3fbe4` | `4074f48adb2a22d9d07792cbe0d8b8f59c63e499ef7b9722066fbb8d3d4d74b0` | `4074f48adb2a22d9d07792cbe0d8b8f59c63e499ef7b9722066fbb8d3d4d74b0` | **KHỚP 100%** |
| `package.json` | `8703cc23c938d2279fa7b4cb7df51a777d1caefebfcce79c6bb163158ff8a1a3` | `8703cc2371e856cf0609b56a7e9dd79988512649f939ef6dcbfdc206d8b29cf1` | `8703cc2371e856cf0609b56a7e9dd79988512649f939ef6dcbfdc206d8b29cf1` | **KHỚP 100%** |
| `README.md` | `df276d57fc522501a4bcbe1ee2d2ec32c02c6d48259dcfb554e7d1bcf5ec7cae` | `df276d57efc04b85fa1e8163fe1aa3d5b11d5b2a7de5ec51ba083e5cb04019cd` | `df276d57efc04b85fa1e8163fe1aa3d5b11d5b2a7de5ec51ba083e5cb04019cd` | **KHỚP 100%** |

---

## 3. Kết luận về tính toàn vẹn

- Bản ghi cũ được giữ nguyên trạng trong các thư mục chạy cũ (`1789319254500-install/` và `1789319491600-check/`) để bảo tồn lịch sử tiến trình thực thi.
- Tài liệu này và tệp máy đọc [candidate-artifact.json](candidate-artifact.json) là căn cứ chính thức để sử dụng trong việc phê duyệt artifact tại FS-03.
