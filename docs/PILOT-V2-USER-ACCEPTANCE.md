# Pilot v2 — buổi nghiệm thu do chủ project trực tiếp thực hiện

**Trạng thái:** `OWNER_CARD_REVIEW_CONFIRMED / OWNER_UC1_UC2_UI_UC3_NOT_RUN` (25/09/2026). Chủ project đã trực tiếp xem card Trello và xác nhận tiêu đề, list, hạn, mô tả đúng và dễ hiểu. Các thao tác trên ứng dụng vẫn chưa được nghiệm thu. Người thực hiện: chủ project trong vai điều phối viên nhóm dịch vụ thiết kế/web. Đối chiếu [đặc tả MVP v2](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md) mục 8–9 và [runbook](PILOT-V2-RUNBOOK.md).

**Ghi nhận trực tiếp:** lúc 06:08 UTC ngày 25/09/2026, chủ project trả lời trong cuộc trao đổi rằng card `6ab60b4b91c37a7b0123ccf7` hiển thị đúng cả bốn mục (tiêu đề, list, hạn 15/10/2026, mô tả theo `REQ-SBX-001`) và dễ hiểu. Đây là lời xác nhận của chủ project, chưa kèm screenshot hay log thao tác; không suy rộng thành pass cho UI/API UC1–UC3.

## Chuẩn bị phiên 20–30 phút

1. Dùng tài khoản/principal của chính bạn, giao diện **live** nối đúng API và Sheet `Requests`/board sandbox đã allowlist. Cần xác nhận trước rằng tài khoản đó đăng nhập được vào API với cùng database sandbox; script tạo card trước đây chỉ tạo mật khẩu ngẫu nhiên tồn tại trong một tiến trình rồi đóng server. Ghi URL ứng dụng, giờ, Git HEAD và mode hiển thị. Nếu chưa có phiên đăng nhập phù hợp hoặc màn hình ghi **“Dữ liệu mô phỏng”**, dừng và đánh dấu `BLOCKED`; kết quả fixture không tính là nghiệm thu live.
2. Giữ `PILOT_V2_WRITE_ENABLED=false`. Card của `REQ-SBX-001` đã tạo: [Cập nhật trang chủ](https://trello.com/c/xnkPoAMa/1-c%E1%BA%ADp-nh%E1%BA%ADt-trang-ch%E1%BB%A7), ID `6ab60b4b91c37a7b0123ccf7`, list `Cần làm`. Không chạy lại script tạo card, không bấm **“Phê duyệt & Tạo thẻ ngay”**, không sửa Sheet/Trello trong buổi này. UC2 ở đây chỉ kiểm preview/receipt hiện có; một luồng tạo card mới trên UI cần ca và phạm vi write được duyệt riêng.
3. Chỉ lưu request/run/card ID, ảnh màn hình đã che thông tin riêng và quan sát thực tế. Không chụp/đính kèm API key, token, cookie hay dữ liệu khách hàng. Bạn quyết định cho phép lưu ghi chú/ảnh màn hình trong phạm vi repo hoặc thư mục evidence riêng; nếu không, chỉ ghi kết quả tổng hợp.

## Tác vụ và tiêu chí quan sát

| Tác vụ bạn thực hiện | Thành công khi bạn quan sát được | Không đạt / dừng khi |
|---|---|---|
| **UC1 — kiểm yêu cầu:** tại “Điều phối công việc theo mẫu”, nhập `REQ-SBX-001` cùng Sheet/tab sandbox, bấm **“Kiểm tra yêu cầu”**. Nếu sandbox có một hàng thiếu thông tin đã biết, kiểm thêm hàng đó mà không sửa nguồn. | Checklist nêu đúng dữ kiện nguồn và phần thiếu/mâu thuẫn (nếu có); trạng thái rõ ràng; không có thao tác ghi hay approval; bạn hiểu cần làm gì tiếp theo. | Tự điền thông tin không có trong nguồn, báo đạt khi còn thiếu, lộ dữ liệu nhạy cảm, hoặc phát sinh card/write. Nếu không có hàng thiếu, ghi `NOT_RUN` cho nhánh hỏi lại, không suy diễn từ fixture. |
| **UC2 — đọc lại việc đã duyệt:** nếu đã đăng nhập được vào API dùng đúng database sandbox và principal sở hữu, mở run `81fbbc5a-64e5-4d74-80e9-337a211447cd`, so nguồn/preview/receipt rồi mở card Trello. Nếu thiếu phiên phù hợp, chỉ kiểm card trên Trello và ghi phần run/UI là `BLOCKED`. | Bạn hiểu rõ tiêu đề, mô tả, hạn 15/10/2026, list `Cần làm`, trạng thái approval và link dẫn đúng card ID ở trên; không phát sinh card thứ hai. | Preview/receipt khó hiểu, sai dữ kiện hoặc không mở được card; ghi lỗi chính xác. Bước **tự tay duyệt và tạo card qua UI** được chấm `NOT_RUN` trong phiên này vì không cho phép write mới. |
| **UC3 — tra card:** dùng `REQ-SBX-001`, bấm **“Tra cứu card đã tạo”** rồi mở link kết quả. | Kết quả tìm thấy đúng card ID/board/list và trạng thái hiện tại trên Trello; không cần nhập card ID và không ghi ngược Sheet. | Trả card khác, trạng thái thành công giả khi không xác minh được, hoặc phát sinh write. Nếu môi trường không truy cập được receipt của principal này, ghi `BLOCKED`, không tạo card khác để sửa thử. |

Sau mỗi tác vụ, nói thành lời điều bạn kỳ vọng, điều bạn thấy, chỗ phải dừng/suy nghĩ và mức tự tin từ 1–5. Thử một lần với bàn phím (Tab/Enter), phóng to trình duyệt 200% và kiểm tra nhãn/trạng thái có đọc được. Ghi thiết bị/trình duyệt; quan sát này không thay thế kiểm thử accessibility đầy đủ. Không thực hiện V2-19 bằng cách gây lỗi mạng trên Trello thật.

## Phiếu bằng chứng — điền sau khi thực hiện

**Phiên:** ngày/giờ/múi giờ `_____` · Git HEAD `_____` · URL/mode `_____` · principal (mã, không ghi credential) `_____` · trình duyệt/thiết bị `_____`.

**Đồng ý ghi nhận:** Tôi đồng ý lưu ghi chú `có/không` `_____`; ảnh màn hình đã che dữ liệu riêng `có/không` `_____`; nơi lưu evidence và người được xem `_____`.

| Tác vụ | Kết quả `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN` | Thời gian; lỗi/số lần phải thử | Evidence (run/request/card ID, ảnh hoặc log đã che) | Nhận xét của bạn; độ tự tin 1–5 |
|---|---|---|---|---|
| UC1 đủ thông tin | `_____` | `_____` | `_____` | `_____` |
| UC1 thiếu/mâu thuẫn (nếu có hàng phù hợp) | `_____` | `_____` | `_____` | `_____` |
| UC2 đọc preview/receipt và card đã có | `_____` | `_____` | `_____` | `_____` |
| UC2 tự duyệt/tạo card qua UI | `NOT_RUN` | Không cho phép write mới trong phiên này | Card sandbox hiện có chỉ chứng minh ca API trước đó | `_____` |
| UC3 tra cứu theo request ID | `_____` | `_____` | `_____` | `_____` |
| Bàn phím, zoom 200%, trạng thái dễ hiểu | `_____` | `_____` | `_____` | `_____` |

**Ba điều gây vướng nhất:** `1. _____ 2. _____ 3. _____`
**Điều bạn muốn sửa trước khi dùng tiếp:** `_____`
**Kết luận của chính bạn:** `chấp nhận / chấp nhận có điều kiện / chưa chấp nhận` `_____` · lý do `_____` · xác nhận/ngày `_____`.

Chỉ ghi `OWNER_ACCEPTANCE_RECORDED` sau khi bạn thực hiện và điền bằng chứng. Báo kết quả **từng UC**, không gộp `PASS` nếu UC2 UI write còn `NOT_RUN`, có nhánh `BLOCKED`, hoặc bằng chứng chỉ đến từ fixture. Một phiên với một người không tự chứng minh khả dụng cho toàn bộ nhóm/khách hàng; trạng thái bàn giao tiếp tục theo các cổng AI, an toàn và live trong runbook.
