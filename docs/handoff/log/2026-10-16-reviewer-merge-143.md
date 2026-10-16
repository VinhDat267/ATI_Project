# 16/10/2026 · Merge #143 (GMAIL-02)

**Người viết:** reviewer · **Nhánh:** `docs/record-143` · Chỉ tài liệu.

## Merge

- [#143](https://github.com/VinhDat267/ATI_Project/pull/143), head `57c4888a047e8b70ddba6de6a2b5bfc28759f8ad`, merge `7c260c1`, 16/10 lúc 13:09:01 Việt Nam.
- Merge theo lệnh "merge #143" của nhóm trưởng, khoá theo head (`--match-head-commit`).
- [CI #143](https://github.com/VinhDat267/ATI_Project/actions/runs/38692036175) SUCCESS đúng head, gồm check và browser.
- Nhánh tách từ `main` `61d3be4` và `main` chưa đổi, nên cây `7c260c1` bằng cây `57c4888` (`4aa5eb5`, kiểm bằng `git rev-parse`).

## Review trước merge

- **Bản đầu `3d3072b`:** review độc lập kết luận **chưa đạt**, 2 P1 và 4 P2:
  - P1: parser người tham gia nhận địa chỉ trong tên hiển thị; grounding nhận địa chỉ khác địa chỉ người dùng gõ;
  - P2: 401 rồi refresh lỗi vẫn thành `unknown`; làm mới token nhiều hơn một lần; response 2xx thiếu id vẫn báo thành công; output `modify_thread_labels` sai.

  Bên thi công sửa cả sáu ở `dd80504` và kiểm RED/GREEN. Review tại `78e6421` (dưới đây) xem toàn bộ PR, gồm cả bản sửa này; xem [log thi công](2026-10-14-codex-GMAIL-02-gmail-tools.md).
- **Tại `78e6421`:** [review độc lập](https://github.com/VinhDat267/ATI_Project/pull/143#issuecomment-6183517969) kết luận **Đạt sau khi sửa nhỏ**.
  - P2: đột biến R8 (lệnh ghi đã gửi bị đánh dấu `requestSent: false`) lọt toàn bộ test. Khi đó executor trả `failed`, cho thử lại, và thư có thể bị gửi hai lần.
  - 3 P3: đặc tả mục 3.8 nói sai về dữ liệu giữ lại; output ghi chưa chuẩn hoá; 401 không phải JSON ở lệnh ghi thành `UNKNOWN`.
  - Reviewer chạy: `npm run check` 1.922 v3 + 173 eval (lượt đầu fail vì test chập chờn của GMAIL-01), browser 101 pass/1 skip, 8/9 đột biến bị bắt.
- **Phần sửa `57c4888`** chỉ có test và tài liệu ([log sửa](2026-10-15-codex-GMAIL-02-review-R8.md)). [Review lại](https://github.com/VinhDat267/ATI_Project/pull/143#issuecomment-6208991418) kết luận **Đạt**:
  - 5/5 đột biến vào bất biến chống gửi trùng bị bắt (R8, R10–R13);
  - 8 ca mới chạy lặp 5 lần đều đạt; `npm run typecheck:v3` exit 0;
  - không chạy lại full check/browser ở máy, dựa vào CI đúng head (1.926 v3 + 173 eval, browser 101 pass/1 skip).

## Cập nhật bàn giao

- `CURRENT-STATE.md`:
  - đầu file;
  - mục 2: các dòng planner, executor, tool-adapters;
  - mục 3: số liệu sau #143, bảng test 1.926 v3;
  - mục 4: #143, #141;
  - mục 5: dòng giới hạn Gmail, dòng 2 P3 adapter, dòng test GMAIL-01 chập chờn;
  - mục 6: cách sandbox chạy Gmail.
- `ROADMAP.md`: GMAIL-02 xong; ANS-01 đã review, chờ sửa và rebase; ghi chú GMAIL-03; đoạn "Cập nhật 16/10 (GMAIL-02)".
- Đặc tả Gmail mục 3.8 (P3 số 1 của review): `working_memory` còn giữ tiêu đề luồng trong `__labels` (không gửi cho model), và nhãn xem trước của kế hoạch có tiêu đề luồng và nguồn người nhận. GMAIL-03 dựa vào mục này để viết `/privacy`.
- Task card GMAIL-02: trạng thái xong.

## Đã dọn

- Worktree review `ATI_Project-review-pr143` của reviewer: chỉ có `node_modules` và `dist` bị ignore, đã xoá. Nhánh trên GitHub tự xoá khi merge. PostgreSQL tạm đã xoá.
- Giữ nguyên vì còn bằng chứng bị ignore, chờ nhóm trưởng quyết:
  - `ATI_Project-wt-gmail-02` (nhánh `feat/gmail-02-gmail-tools`, có `.codex/`);
  - `ATI_Project-wt-gmail-02-mutations` (`65e4619`);
  - `ATI_Project-review-gmail-02` (`3d3072b`, có `.review-evidence/`).

## Chưa kiểm

- CI `main` sau #143 (`7c260c1`) đang chạy khi viết log này.
- Không chạy lại `npm run check` hay browser ở máy cho cập nhật bàn giao. Không gọi Google hay model.
