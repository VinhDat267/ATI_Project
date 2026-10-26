# REHEARSAL-01 · Diễn tập bảo vệ

**Trạng thái:** chờ · **Người làm:** cả nhóm, nhóm trưởng (`VinhDat267`) điều phối · **Phụ thuộc:** SLIDES-01, DEMO-01, VIDEO-01 · **Mốc:** lần 1 ngày 09/11, lần 2 ngày 10/11/2026; bảo vệ 11/11
**Kế hoạch tổng:** [FINISH-PLAN](../FINISH-PLAN.md).

## Phân vai (nhóm trưởng điền)

| Phần | Người trình bày | Người dự phòng |
|---|---|---|
| Slide 1–7 | | |
| Demo (lái máy) | | |
| Demo (thuyết minh) | | |
| Slide 9–16 | | |
| Hỏi đáp: kỹ thuật planner/an toàn | | |
| Hỏi đáp: đánh giá và số liệu | | |
| Hỏi đáp: quy trình, công cụ AI | | |

## Diễn tập lần 1 (09/11)

1. Chạy đủ: slide, demo trực tiếp 3 kịch bản, hỏi đáp thử 10 phút. Bấm giờ từng phần.
2. **Diễn tập sự cố**, mỗi loại một lần:
   - 9router tắt giữa demo → chuyển `cx/gpt-6.1-sol` theo runbook. Ghi thời gian chuyển;
   - mất mạng → chuyển sang VIDEO-01 ngay đúng đoạn đang demo;
   - lập kế hoạch quá 60 s → nói gì trong lúc chờ, khi nào bấm "Thôi chờ".
3. Ghi biên bản `docs/handoff/log/<ngày>-<người>-rehearsal-1.md`: thời gian từng phần, câu hỏi trả lời chưa tốt, việc cần sửa ở slide hoặc runbook.

## Diễn tập lần 2 (10/11)

- Chạy lại toàn bộ sau khi sửa; lệch thời lượng ≤ 1 phút.
- Chạy checklist ngày bảo vệ ở dưới, trên đúng máy sẽ dùng.

## Câu hỏi dễ gặp (chuẩn bị câu trả lời, mỗi câu 30–60 giây, chỉ dùng số liệu có nguồn)

1. Vì sao mỗi lần chạy đều phải duyệt? Sao không cho tự chạy?
2. Nếu model bịa ID kênh hoặc board thì sao? (grounding, validator)
3. Một bước ghi lỗi giữa chừng thì sao? Có chạy lại không? (`unknown` không chạy lại; đối soát)
4. Mã băm kế hoạch dùng để làm gì? Hạn 30 phút để làm gì?
5. Bảo mật khoá dịch vụ, dữ liệu Gmail đi đâu? (mã hoá khi lưu, Gmail riêng của từng người, `/privacy`)
6. Độ chính xác bao nhiêu, đo thế nào, bộ câu do ai viết? (W4-01 không độc lập hoàn toàn: nói thẳng)
7. Tỉ lệ kế hoạch dùng được với người dùng thật? (W4-03)
8. Độ trễ? Vì sao có lúc quá 30 s? (W4-04, W4-01, giới hạn)
9. Thêm một dịch vụ mới cần sửa những gì? (W3-00, registry)
10. Lịch chạy hoạt động thế nào, có tự ghi không? (mỗi lượt chờ duyệt)
11. Nhóm dùng công cụ AI thế nào, làm sao kiểm chất lượng? (task card, review độc lập, TDD, đột biến, CI)
12. Giới hạn lớn nhất là gì, nếu có thêm thời gian sẽ làm gì?

## Checklist ngày bảo vệ (15 phút trước giờ)

- [ ] Máy cắm điện, tắt thông báo, tắt cập nhật tự động.
- [ ] 9router chạy; gọi thử một câu tới màn duyệt rồi Hủy.
- [ ] Docker và DB demo chạy; app ở chế độ live trên đúng tag demo.
- [ ] `/settings`: 8 dịch vụ `healthy`; Gmail đã kết nối (nếu bật).
- [ ] Tài nguyên thử đã dọn theo runbook.
- [ ] Slide và PDF mở sẵn; VIDEO-01 mở sẵn ở tab khác; USB dự phòng.
- [ ] Trình duyệt đăng nhập sẵn tài khoản demo; phóng chữ 110–125%.

## Tiêu chí nghiệm thu

- [ ] Hai lần diễn tập có biên bản; lần 2 đúng thời lượng.
- [ ] Ba loại sự cố đã diễn tập; thời gian chuyển LLM dự phòng ≤ 3 phút.
- [ ] Mỗi câu hỏi ở danh sách có người phụ trách và câu trả lời có nguồn.

## Kết quả (người làm điền)

- Biên bản lần 1, lần 2:
- Việc đã sửa sau diễn tập:
