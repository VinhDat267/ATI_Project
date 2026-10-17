# 18/10/2026 · GMAIL-03 · Sửa P3 của review lại #147

**Người viết:** reviewer. Nhóm trưởng giao sửa thay `longnguyen005` đang bận. **Nhánh:** `codex/feat-gmail-03-ui` (#147), từ head `9c46f89`. Task: [GMAIL-03](../tasks/GMAIL-03-gmail-ui.md). [Review lại](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6237634859) `a2d622e..9c46f89` (17/10): đạt sau khi sửa nhỏ, 1 P3.

## Đã sửa

- **P3: tiêu đề luồng dài không xuống dòng ở "Đích đến".** Từ `9c46f89`, đích của bước Gmail là tiêu đề luồng thật. Một tiêu đề liền ký tự, không có khoảng trắng, tràn khỏi thẻ; reviewer đo được trang 375 px rộng thành 1.120 px.
  - `PlanMoment.tsx`: dòng "Đích đến" của thẻ duyệt thêm `break-words`, giống dòng "Gửi từ" ngay trên.
  - `ReceiptMoment.tsx`: dòng đích của thẻ biên nhận cũng tràn với cùng tiêu đề (test mới bắt được sau khi sửa thẻ duyệt), nên thêm `break-words`. Review không nêu chỗ này.
  - Màn đang chạy (`ExecutionMoment`) đã cắt dòng bằng `truncate`, không tràn; hộp xem trước dùng `GmailPreview`, vốn có `break-words`. Không đổi logic tra tool hay dữ liệu.
- **Ca browser** trong `gmail-03.spec.ts`, chạy ở 1440/375 sáng/tối:
  - kiểm thẻ duyệt hiện "Đích đến: Họp nhóm ATI";
  - đặt tiêu đề `'X'.repeat(120)` cho luồng `gmail-thread-1` trong `resource_labels` của kế hoạch đang chờ, trong database tạm của test (nhãn hiển thị nằm ngoài mã băm duyệt), rồi tải lại;
  - kiểm dòng "Đích đến" và dòng đích của biên nhận không rộng hơn khung của chính nó, và trang không cuộn ngang. Lúc mở xem trước, kiểm có sẵn về cuộn ngang nay chạy với tiêu đề dài.

## Kiểm thử

PostgreSQL 16 tmpfs riêng ở 55533, sandbox, không dùng `.env`. Nhóm `gmail` chạy riêng bằng cùng biến môi trường và fixture với `scripts/test-v3-browser.mjs`.

- RED 1, chưa sửa: **4/4 fail**, đều ở kiểm dòng "Đích đến" của thẻ duyệt (`gmail-03.spec.ts:85`).
- RED 2, mới sửa thẻ duyệt: **4/4 fail**, đều ở dòng đích của biên nhận (`gmail-03.spec.ts:99`).
- GREEN: **4/4 pass**. Lượt này có dòng log `Gmail revoke failed: rejected`, do kết nối Gmail còn sót trong database từ lượt RED 2 (token của fixture đã dừng); lượt toàn bộ dưới đây chạy trên database mới.
- Test web **745/745** (chạy trong `apps/chat-web`); typecheck web exit 0.
- `npm run test:browser:v3` (tài khoản CI), mỗi lượt trên database mới:
  - lượt 1 **exit 1**: nhóm default 87 pass / 1 fail / 1 skip. Ca fail là `FE-07: dark mobile page/drawer …`, hết 30 s chờ ô Email ở `/login`, không có snapshot trang; cùng dạng chập chờn đã ghi ở CURRENT-STATE mục 5. Phần sửa không đụng trang đăng nhập hay `/settings`. Runner dừng sau nhóm lỗi nên các nhóm sau chưa chạy;
  - lượt 2 **exit 0**: **115 pass, 1 skip có chủ đích, 13 nhóm** (default 88, gmail 4), bằng số của lượt trước phần sửa.

Không gọi Google hay model thật. Không chạy lại `npm run check`: phần sửa chỉ thêm một class ở hai file web và một đoạn test browser; CI chạy lại check.
