# Thiết kế đánh giá

## Phạm vi v2 đã duyệt — 21/09/2026

Dùng [dataset contract v2](MVP-V2-DATASET.md) và 20 tình huống trong đặc tả.
Đây là yêu cầu đã duyệt, dataset code/test results vẫn chưa được tạo/chạy.
Giữ nguyên `testdata/test-cases.json`, `tools.json`, `experiment-manifest.json`
của B; không trộn denominator giữa hai profile hay sửa holdout cũ trong batch docs.

Tách CONTRACT_TESTED, SAAS_LIVE_EXERCISED, AI_QUALITY_MEASURED,
CUSTOMER_VALIDATED. Nhóm đóng vai chỉ là thử nghiệm mô phỏng; nhãn cuối vẫn
NOT_RUN. 20 case công khai là acceptance set; holdout mới phải được đóng băng
riêng trước đo. Giữ đối chứng semantic/semantic+QE và tính mọi call/budget.

## Phương pháp và evidence B/local lịch sử

**NOT_RUN:** chưa có thí nghiệm AI so sánh model/retrieval/query expansion/replan. FS-05 đã đạt **TECHNICAL PASS** cho controller hai server với 8 public `task_hub` tools và 2 public `filesystem` tools; fresh FS-06 gate đạt **258 passed, 1 skipped**. Đây là bằng chứng plan tay/runtime trên fixture local, không phải kết quả thực nghiệm AI. 10 fixture B/local là bộ kiểm tính biểu diễn và oracle ban đầu, chưa đủ quy mô kết luận accuracy tổng quát. Xem [filesystem status](G1-FILESYSTEM-STATUS-2026-09-13.md).

## Đo đúng câu hỏi

| Chỉ số | Định nghĩa |
|---|---|
| Plan validity | PlannerResult parse; nếu kind=plan, WorkflowPlan + graph + policy + resolved args/output hợp lệ. Refusal không trộn denominator plan |
| Task correctness | Đúng target, filter, dữ liệu, thứ tự bắt buộc và final state; mọi side-effect phải được phép. SUCCEEDED đơn thuần không đủ |
| Refusal/clarification | Chấm outcome theo thiếu capability hoặc thiếu thông tin; kiểm không có call write. Chấp nhận diễn đạt tương đương |
| Recall@K | Với gold tool set không rỗng: phần gold có trong retrieved. Case gold rỗng báo riêng, không chia cho 0 |
| Recovery correctness | Sau fault, kết quả đúng và không mutation trùng/ngoài approval; unknown dừng/reconcile đúng |
| Cost/latency | Tổng mọi call QE, embedding query, planner, repair, replan, retries; báo tokens và pricing snapshot |

All-tools có recall=1 khi gold có đủ trong catalog theo định nghĩa; không dùng điều đó kết luận planner đúng hơn. So all-tools, semantic, semantic_qe trên cùng model, prompt base, data snapshot, top-K và ngân sách. Không dùng catalog 10/20/50 tùy ý làm mất gold tool; manifest cần assert gold subset với từng variant. B hiện có catalog 10; scale experiment ngoài scope.

## Freeze trước final evaluation

Dùng b01–b06 cho development. b07–b10 giữ lại cho evaluation; nếu đã dùng tune phải thay holdout. Manifest lưu hashes catalog/dataset/prompts, model/provider/version/settings, embedding, receiver versions, repetitions (đề xuất 3/case/variant), price source/date. Tách thời gian read/tool với thời gian model nhưng báo thêm tổng end-to-end. Chạy các variant xen kẽ thứ tự để giảm ảnh hưởng tải/time.

Gold plans là một cách giải hợp lệ. Chấm plans khác bằng kết quả/allowed effects, không exact JSON hoặc exact tool order khi các bước độc lập. Con người đối chiếu task correctness và các ca khó, ghi người đánh giá/quy tắc/khác biệt; fixture writer không tự nhận independent ground truth validation.

Báo tử số/mẫu số, p50/p95 latency, mean/spread cost; với sample nhỏ công bố từng case và giới hạn. Tỷ lệ AI là exploratory vì chưa có rubric/nhu cầu đo; không đặt accuracy threshold sau khi xem holdout để tuyên bố đạt. Ngưỡng correctness bắt buộc cố định: 0 extra/unapproved writes, 0 dry-run writes, 0 blind retry unknown writes; mọi hand-plan dev fixture chạy đúng. Fault suite ít nhất forged read, stale approval, double claim, commit-lost-response, crash và changed-payload conflict.

Nguồn rubric chính thức và representative group work/user validation còn `OPEN`. HTTP/session/UI, polling 2 giây và AI evaluation còn `NOT_RUN`; vì vậy G1 overall là `PARTIAL` dù technical gate đã pass. Không dùng trọng số điểm từ bản proposal cũ, hand-plan tests hoặc model confidence làm evidence.
