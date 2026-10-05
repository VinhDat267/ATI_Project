# DOC-01 · Sửa liên kết lưu trữ trong tài liệu HTML sau #80

**Trạng thái:** thi công xong, chờ review/merge · **Nhánh:** `vinhdat/fix-pr80-archive-links` · **Phụ thuộc:** #80 đã merge, tag `archive/v2-final` tồn tại trên origin.

## Vấn đề

Review độc lập #80 ngày 05/10/2026 phát hiện năm liên kết hỏng trong hai tài liệu được giữ lại: `docs/screens.html` có hai link tới `BASELINE.md`, `API.md`; `docs/wireframes.html` có ba link tới `BASELINE.md`, `API.md`, `EXECUTION-CONTRACT.md`. Các đích đã bị xoá khỏi main trong #80.

## Phạm vi

- Chuyển năm liên kết sang bản tài liệu tại tag `archive/v2-final` trên GitHub; thêm nhãn "lưu trữ" để phân biệt tài liệu lịch sử.
- Giữ liên kết tới tài liệu còn tồn tại ở checkout hiện tại.
- Không đổi CSS, mã ứng dụng, manifest, `DESIGN.md`, `PRODUCT.md`, `CURRENT-STATE.md` hoặc `ROADMAP.md`.

## Tiêu chí nghiệm thu

- [x] Kiểm tra trước sửa ghi nhận đúng năm đích local không tồn tại.
- [x] Sau sửa: năm link lưu trữ, không còn link local hỏng trong hai file.
- [x] GitHub Contents API xác nhận ba tài liệu đích tồn tại tại tag; URL trong HTML bằng `html_url` trả về.
- [x] `git diff --check` exit 0; chỉ thay đổi hai dòng HTML và tài liệu bàn giao của task.

## Kết quả (agent thi công điền)

- Commit sửa HTML: `1d7473ad6e2509c936746a819bc7a9306a6f10d8`.
- Trước sửa, kiểm tra `href` bằng Node và filesystem: 2 file, 9 link local, 0 link archive, 5 đích không tồn tại; exit 1 đúng kỳ vọng.
- Sau sửa: 2 file, 4 link local, 5 link archive, `missing=[]`, `wrongArchiveCounts=[]`; exit 0. Phân bố archive: BASELINE 2, API 2, EXECUTION-CONTRACT 1.
- Ba lệnh `gh api repos/VinhDat267/ATI_Project/contents/docs/<file>?ref=archive%2Fv2-final` đều exit 0 và trả `html_url` bằng URL đã điền trong HTML. Remote tag peel về `badccb3a47f2240c8b1356885c03c6abe25ad43d`.
- `git diff --check` exit 0; không đổi bố cục, CSS hoặc runtime v3.
- Không thêm test tự động hay chạy lại suite ứng dụng local cho thay đổi liên kết tài liệu. CI và review độc lập là gate trước merge; chưa merge trong phiên thi công.
