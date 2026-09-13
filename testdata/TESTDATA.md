# Dataset B/local

Nguồn active: tools.json (8 task_hub + 2 filesystem adapter contracts), test-cases.json (10 case: 6 dev, 4 holdout), experiment-manifest.json. Case/plan là fixture viết tay, không kết quả model. Ba schema read_sheet_range/append_sheet_rows/send_slack_message đã đồng bộ và đối chiếu tools/list thật; 7 schema còn lại vẫn SPEC_ONLY, xem evidence theo từng tool trong catalog. Bộ cũ 27 tool/30 case nằm trong archive trước sửa; không dùng làm denominator mới.

Mỗi case có expected_result (plan/refusal/clarification), read fixture, expected writes với args cụ thể, output kỳ vọng và cấm write ngoài danh sách. Plan chuẩn nhằm chứng minh tác vụ biểu diễn được trong DSL. Câu từ refusal/clarification có thể tương đương; grader không buộc model sao chép nguyên câu mẫu.

Luồng b02 chép nguyên string[][] có sẵn từ read_sheet_range.values sang append_sheet_rows.rows; notify dùng row_count scalar từ read, không dùng output của append. Thứ tự notify sau append là dependency điều khiển hợp lệ. B không giả định có map/min/summarize/loop. b09 từ chối vì capability, b05/b10 hỏi vì thiếu định danh.

Kiểm thử fixture offline resolve args, validate schema/policy, đối chiếu payload writes/outputs và thử biến đổi payload sai. Riêng integration test b02 đã gọi read→append→notify qua MCP thật và đối chiếu DB, với controller fixture tạo approval riêng cho từng write. Chưa có một preview chung/controller/engine thật; kết quả này không chứng minh toàn workflow runtime. Các case còn lại và filesystem chưa có bằng chứng tích hợp.

Holdout đã công khai cho contract review nhưng chưa dùng tune prompt/model. Nếu người làm tune xem/sửa theo nó, phải chuyển thành dev và bổ sung holdout mới trước freeze. Dataset nhỏ chỉ đủ smoke/feasibility; không suy ra accuracy tổng quát. Filesystem có contract nhưng chưa có case thực thi được xác minh; G1 phải thêm ít nhất một fixture + adapter call thật trước tuyên bố demo hai server.
