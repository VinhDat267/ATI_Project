# SLIDES-01 · Slide bảo vệ

**Trạng thái:** chờ · **Người làm:** nhóm trưởng (`VinhDat267`) và các thành viên · **Phụ thuộc:** REPORT-01 (số liệu), DEMO-01 (kịch bản) · **Mốc:** bản đủ 08/11/2026; sửa sau diễn tập 09–10/11
**Kế hoạch tổng:** [FINISH-PLAN](../FINISH-PLAN.md).

## Thông tin nhóm trưởng điền trước khi làm

- Thời lượng trình bày, thời lượng hỏi đáp:
- Hình thức: trực tiếp hay trực tuyến; máy chiếu của phòng hay máy của nhóm:
- Yêu cầu nộp slide trước (hạn, định dạng):

Phần dưới giả định **15 phút trình bày + 5 phút demo**. Đổi số slide theo thời lượng thật.

## Dàn ý đề xuất (khoảng 16 slide)

| # | Slide | Nội dung | Thời gian |
|---|---|---|---|
| 1 | Tiêu đề | Tên đề tài, nhóm, giảng viên | 0:20 |
| 2 | Bài toán | 4–5 thao tác thủ công trên nhiều công cụ cho một việc; ví dụ cụ thể | 1:00 |
| 3 | Mục tiêu và phạm vi | Một câu chat → kế hoạch nhiều bước → người dùng duyệt → chạy; 8 dịch vụ (+ Gmail, lịch chạy nếu bật) | 1:00 |
| 4 | Nguyên tắc an toàn | Chỉ ghi khi duyệt đúng kế hoạch (mã băm, hạn 30 phút); `unknown` không chạy lại; không bịa ID (grounding) | 1:00 |
| 5 | Kiến trúc | Sơ đồ khối, một hình | 1:00 |
| 6 | Planner | Router → tra cứu → model → validator 5 lớp; ví dụ một kế hoạch JSON rút gọn | 1:30 |
| 7 | Thực thi và khôi phục | `$ref`, trạng thái từng bước, đối soát khi khởi động lại | 1:00 |
| 8 | Demo | Chuyển sang app (DEMO-01) | 5:00 |
| 9 | Tính năng sau giữa kỳ | Gmail riêng, kiểu "trả lời", lịch chạy, OAuth trong hội thoại (chỉ những gì đã merge; ghi rõ cờ bật hay tắt) | 1:00 |
| 10 | Đánh giá: golden | Bảng số liệu có ngày đo và model | 1:00 |
| 11 | Đánh giá: người dùng và độ trễ | W4-03 (tỉ lệ dùng được, Wilson 95%), W4-04 (p50/p95 qua giao diện) | 1:00 |
| 12 | Chất lượng mã | Số test, CI, review độc lập, đột biến | 0:40 |
| 13 | Quy trình làm việc | Task card → thi công → review độc lập → merge → ghi bàn giao | 0:40 |
| 14 | Giới hạn | 4–5 giới hạn quan trọng nhất của REPORT-01 mục 10 | 0:40 |
| 15 | Hướng phát triển | OAuth cho dịch vụ khác, chế độ tự chạy có giới hạn, nhiều instance | 0:30 |
| 16 | Kết luận và hỏi đáp | — | 0:30 |

## Quy tắc

- Số liệu trên slide **giống từng chữ số** với báo cáo; mỗi bảng ghi ngày đo.
- Không ảnh nào có token, email cá nhân hay khoá dịch vụ; tên tài nguyên thử dùng được.
- Theo màu và chữ của design system Agentic: cam `#FF5701`; Be Vietnam Pro, Playfair Display.
- Lưu ở máy nhóm trưởng và Drive của nhóm; không commit nếu có dữ liệu thật.

## Tiêu chí nghiệm thu

- [ ] Đủ dàn ý, đúng thời lượng khi diễn tập (lệch ≤ 1 phút).
- [ ] Số liệu khớp báo cáo.
- [ ] Có bản PDF dự phòng, mở được không cần mạng.

## Kết quả (người làm điền)

- File:
- Thời lượng đo ở diễn tập:
