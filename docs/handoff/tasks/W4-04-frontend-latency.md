# W4-04 · Đo latency qua frontend với số mẫu đủ lớn

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w4-04-frontend-latency` · **Phụ thuộc:** không

## Vấn đề

Thời gian từ lúc gửi câu chat tới khi plan preview hiện ra mới được đo qua frontend **hai lần** (17,3 s và 8,6 s), chênh nhau gấp đôi. Các số p50/p95 khác đều đo qua script gọi thẳng planner, không qua frontend, backend và SSE. Báo cáo cuối kỳ cần ít nhất 20 lượt đo qua đúng đường đi của sản phẩm.

## Việc cần làm

1. Thêm chế độ đo hàng loạt cho `evaluations/live-app/` (ví dụ biến `LIVE_APP_PROMPTS_FILE`): đọc danh sách câu chat từ file, với mỗi câu:
   - gửi câu chat qua frontend; ghi thời điểm gửi, thời điểm thấy plan preview (hoặc câu hỏi làm rõ, hoặc thông báo từ chối), và loại câu trả lời;
   - **luôn bấm Hủy**, không bao giờ bấm Duyệt. Chế độ này không được ghi gì ra service thật;
   - nghỉ giữa các câu để không vượt rate limit của model.
2. Lấy thêm thời gian của từng giai đoạn từ phía server nếu có thể đọc được mà không sửa code sản phẩm (ví dụ thời điểm lưu tin nhắn và thời điểm lưu plan trong PostgreSQL), để tách thời gian của model khỏi thời gian của frontend/SSE.
3. Bộ ≥ 20 câu đo: lấy từ bộ 18 câu tự do và bộ Sheets (W3-03), đổi tài nguyên sang tài nguyên thử nghiệm thật; có cả câu một, hai, ba và bốn service.
4. Chạy chế độ live với model thật, ghi bằng chứng vào `docs/ai-evidence/V3-LIVE-EXECUTION/` (không commit), tóm tắt p50/p95/max theo số service vào `evaluations/README.md`.

## Tiêu chí nghiệm thu

- [ ] Test (sandbox, browser thật) cho chế độ đo hàng loạt: chạy hết danh sách, mọi plan kết thúc ở trạng thái `rejected`, **không có dòng nào trong `execution_steps`**.
- [ ] Có ≥ 20 lượt đo live, mỗi lượt ghi loại câu trả lời và thời gian.
- [ ] Kết quả nói rõ phần trăm lượt dưới 15 s (chỉ tiêu của đặc tả) và tách được thời gian model với phần còn lại, hoặc ghi rõ vì sao chưa tách được.
- [ ] `npm run check` exit 0.

## Kết quả (agent thi công điền)

- PR:
- Bằng chứng:
- Kết quả:
- Điều chưa làm hoặc khác với task card:
