# FLOW-08 · Sửa sáu phát hiện review PR #277

**Trạng thái:** code/offline đã kiểm chứng; chờ CI/review đúng commit · **Nhánh:** `fix/flow-review-regressions` · **Base:** `ff9d24e47f3d8f529fd181330f17073c9b6ef5e6`

## Phạm vi và thiết kế

Theo yêu cầu chủ dự án sửa sáu phát hiện của PR #277 và [đặc tả luồng hiện có](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).

- Dùng chung nhận diện yêu cầu báo cáo ở planner/validator/API. API bám message gốc theo metadata server `planId`/`replyToMessageId`; giữ độ chính xác timestamp bằng SQL khi đọc history, không dựa riêng vào tiêu đề model. Giữ luồng gửi nguyên văn.
- Một artifact nguồn được dùng cho mọi trường nội dung gửi trong cùng báo cáo; planner dựng mọi bản gửi từ artifact, validator/API kiểm từng trường. Không thêm tool hay thay schema nhà cung cấp.
- Renderer dùng output chuẩn `url` của GitHub. Sheets có `values` nhưng chưa biết header thì hỏi lại trước khi gửi; không tự bật `headerAware` hoặc đổi range vì có thể làm mất dòng A2. Giữ header mode đã chỉ định.
- Hủy bản nháp defaults khi đổi tài khoản/workspace và kiểm scope ngay lúc Save.
- Ruling: yêu cầu trộn báo cáo và tin nhắn nguyên văn khác nhau, hoặc nội dung công việc riêng, được hỏi lại/tách yêu cầu. Không đoán phân loại đích từ một đoạn quote rồi bỏ kiểm chứng toàn bộ bản gửi.
- Phân loại đúng test fixture/offline, mở lại gate live FLOW-07; không tạo bằng chứng model/provider thật từ fixture. Giữ riêng operator attestation đã có.

## Kế hoạch thực hiện

- [x] RED: thêm regression natural Vietnamese/English, gửi nguyên văn, hai đích/tamper bước đầu, native GitHub/Sheets và defaults đổi scope.
- [x] GREEN: shared intent + planner/validator/ChatService/ExecutionService guards; renderer native contract; defaults scope.
- [x] Sửa tên/phạm vi test nghiệm thu và task FLOW-07, ghi các gate chưa chạy thật.
- [x] Chạy targeted/package/typecheck/build/browser và full check trên PostgreSQL thử riêng; ghi đầy đủ giới hạn/lỗi nếu có.
- [x] Tự kiểm diff, review độc lập source và thêm handoff log. Không merge hay sửa CURRENT-STATE/ROADMAP.
- [ ] Commit đúng file và đối chiếu CI/review đúng SHA cuối.

## Điểm cần review

Yêu cầu không dùng chữ “báo cáo”; literal người dùng tự soạn; nhiều text/body/content trong plan; Sheets không có header; đổi scope khi editor còn mở; timestamp request/plan cùng millisecond nhưng khác microsecond. Mỗi trường hợp có regression hành vi tương ứng.

## Kết quả

Sáu phát hiện đã xử lý ở code và tính đúng của tuyên bố nghiệm thu. Xem [log kiểm chứng](../log/2026-11-04-FLOW-08-pr277-review-fixes.md): full check exit 0, source cuối schemas 577/planner 547 PASS, API full 2471 PASS, evaluation 500 PASS + 1 preflight SKIP; browser thật và native-adapter/SQL/HTTP dispatch probe PASS. Reviewer độc lập không còn P1/P2 cụ thể; chờ đối chiếu commit cuối/CI. FLOW-07 live vẫn OPEN.
