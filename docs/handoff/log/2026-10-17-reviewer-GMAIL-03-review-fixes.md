# 17/10/2026 · GMAIL-03 · Sửa theo review #147

**Người viết:** reviewer. Nhóm trưởng giao sửa thay `longnguyen005` đang bận. **Nhánh:** `codex/feat-gmail-03-ui` (#147), từ head `a2d622e`. Task: [GMAIL-03](../tasks/GMAIL-03-gmail-ui.md). [Review](https://github.com/VinhDat267/ATI_Project/pull/147) (17/10): đạt sau khi sửa nhỏ, 1 P2, 3 P3.

Reviewer vừa review vừa sửa, nên phần sửa này cần một reviewer độc lập khác.

## Gộp `main`

`main` đã có #148–#151 sau base `87b31e3`, nên nhánh xung đột. Đã gộp bằng merge commit `0179ef3`, không rebase, để giữ nguyên commit của `longnguyen005`. Xung đột duy nhất là grep nhóm `default` trong `scripts/test-v3-browser.mjs`; bản gộp giữ cả `GMAIL-03 off:` (của #147) và `W4-04:` (của #151).

## Đã sửa

- **P2: thẻ duyệt và xem trước mô tả sai bước Gmail.**
  - `apps/chat-web/src/services/tool-definitions.ts`: `toolDefinition(name)` tra `ALL_TOOLS` rồi `GMAIL_TOOLS`, giống `resource-labels.ts` phía server. 11 file web tra tool chuyển sang hàm này; tool của 8 dịch vụ chung tra ra như cũ.
  - `assets/cockpit-services.json` khai báo nhãn hành động cho 7 tool ghi Gmail:
    - `send_message` "Gửi thư";
    - `reply` "Trả lời thư";
    - `forward` "Chuyển tiếp thư";
    - `create_draft` "Tạo thư nháp";
    - `modify_thread_labels` "Đổi nhãn";
    - `trash_thread` "Chuyển vào thùng rác";
    - `create_label` "Tạo nhãn".

    Thêm tên tài nguyên `thread` "Luồng thư" và `label` "Nhãn".
  - `resourceDestination`: "Đích đến" của bước Gmail là tiêu đề luồng thư lấy từ `resourceLabels`. Nhãn là thứ bước gắn vào luồng, không phải nơi ghi, nên không tính là đích.
  - `GmailPreview`: tên trường tiếng Việt; luồng thư và nhãn hiện tên từ `resourceLabels`. Khi không có tên, hiện "`<id>` · chưa có tiêu đề/tên trong dữ liệu" thay vì để ID trông như tiêu đề. Bước `trash_thread` có câu "Luồng thư này sẽ được chuyển vào Thùng rác của Gmail."
- **P3:**
  - **Landing:** thẻ "Gmail · Của riêng bạn" chuyển từ `stage-panel-2` (khoảnh khắc demo bị `inert`) sang lưới dịch vụ `integrations-section`. Vẫn chỉ hiện khi Gmail bật.
  - **Test hồi quy:**
    - G5: link "Mở thư mục Đã gửi" không hiện khi bước `failed`;
    - G11: mục "Dữ liệu Gmail" của `/privacy` chỉ hiện khi cờ bật.
  - **Hộp ngắt kết nối:** nút huỷ đổi thành "Giữ kết nối", kiểu nút phụ.

## Kiểm thử

- PostgreSQL 16 tmpfs riêng ở 55533, sandbox, `GMAIL_ENABLED=off`, `PLANNER_READ_ANSWERS=off`, không dùng `.env`.
- RED: `apps/chat-web/tests/gmail-review-fixes.test.tsx` (18 test) trên mã cũ cho 15 fail / 3 pass. Ba ca đạt ngay là G5 và hai ca `/privacy`; mã cũ đúng ở đó, nên đây là test hồi quy, được chứng minh bằng đột biến.
- GREEN: 18/18. Toàn bộ test web 745/745, chạy trong `apps/chat-web`. Typecheck web exit 0.
- Đột biến: 12 đột biến vào phần sửa và hai điều kiện G5/G11, mỗi lần khôi phục và kiểm SHA-256. **12/12 bị bắt.**
- `npm run check`:
  - lượt 1 **exit 1**: 1 fail / 464 pass ở `chat-api`. Ca fail là test GMAIL-01 chập chờn đã biết, `orders disable after the save, never between its check and insert` (dòng 182, lệch 0,12 ms; CURRENT-STATE mục 5). Phần sửa không đụng `apps/chat-api`;
  - lượt 2 **exit 0**: **2.014 v3** (63 + 408 + 291 + 42 + 465 + 745) **+ 275 eval**; quét bản build đạt 7 mẫu.
- `npm run test:browser:v3` (tài khoản CI): **exit 0**, **115 pass, 1 skip có chủ đích, 13 nhóm**. Trong đó default 88, gmail 4, clarification 3; các nhóm còn lại như CI `main`.

Không gọi Google hay model thật.
