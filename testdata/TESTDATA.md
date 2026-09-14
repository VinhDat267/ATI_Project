# Dataset B/local

Nguồn active: tools.json (8 task_hub + 2 filesystem adapter contracts), test-cases.json (10 case: 6 dev, 4 holdout), experiment-manifest.json. Case/plan là fixture viết tay, không kết quả model. Toàn bộ 8 schema của server `task_hub` đã đồng bộ và đối chiếu tools/list thật qua live discovery handshake; 2 schema của `filesystem` đã được live discovery và write integration kiểm chứng; receipt của filesystem vẫn không được giả lập bằng hub_receipts. Bộ cũ 27 tool/30 case nằm trong archive trước sửa; không dùng làm denominator mới.

Mỗi case có expected_result (plan/refusal/clarification), read fixture, expected writes với args cụ thể, output kỳ vọng và cấm write ngoài danh sách. Plan chuẩn nhằm chứng minh tác vụ biểu diễn được trong DSL. Câu từ refusal/clarification có thể tương đương; grader không buộc model sao chép nguyên câu mẫu.

Luồng b02 chép nguyên string[][] có sẵn từ read_sheet_range.values sang append_sheet_rows.rows; notify dùng row_count scalar từ read, không dùng output của append. Thứ tự notify sau append là dependency điều khiển hợp lệ. B không giả định có map/min/summarize/loop. b09 từ chối vì capability, b05/b10 hỏi vì thiếu định danh.

Kiểm thử fixture offline resolve args, validate schema/policy, đối chiếu payload writes/outputs và thử biến đổi payload sai. Controller/engine runtime đã được xây dựng và kiểm chứng thật qua 40 integration tests (`packages/engine/tests/controller.integration.test.ts`), bao gồm luồng một preview/approval cho nhiều write, thực thi tuần tự, trace, timeout unknown, response loss, process crash exit 86, và cạnh tranh concurrent. Cần phân biệt rõ:
- `b02`: bằng chứng tích hợp lịch sử cho luồng sheet + notify.
- `b01`: phiên bản dev thích ứng `b01-fixed-window` với mốc thời gian cố định nhằm kiểm c1 trong khoảng và c2 ngoài khoảng mà không phụ thuộc ngày chạy thật.
- `b03`: fixture dev kiểm card `c1` gửi notify.
- Thí nghiệm AI vẫn giữ trạng thái **NOT_RUN**. Hai tool của filesystem và controller hai server đã có bằng chứng tích hợp; E01–E14, gồm E08 transport-window fault, cả hai mode E10 và E14, đều PASS trong FS-05.

Holdout đã công khai cho contract review nhưng chưa dùng tune prompt/model. Nếu người làm tune xem/sửa theo nó, phải chuyển thành dev và bổ sung holdout mới trước freeze. Dataset nhỏ chỉ đủ smoke/feasibility; không suy ra accuracy tổng quát. Filesystem FS-03/FS-04 và controller/fault evidence FS-05 đã chạy trên fixture/adapter thật; fresh FS-06 gate đạt **258 passed, 1 skipped** và manifest dẫn xuất `TECHNICAL_PASS_OVERALL_PARTIAL`. G1 overall vẫn **PARTIAL** vì rubric chính thức và representative group work `OPEN`; HTTP/session/UI, polling và AI evaluation `NOT_RUN`.
