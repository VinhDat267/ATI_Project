# Prompt và schema

System prompt mô tả PlannerResult: kind plan/refusal/clarification. Chỉ kind=plan mới parse WorkflowPlanSchema để điền defaults và kiểm refinement, rồi validatePlanTools. Generated JSON Schema không bao gồm mọi cross-field refinement; structured-output provider compatibility còn NOT_RUN.

Catalog lấy từ registry đã duyệt. Toàn bộ entry được encode JSON và neutralize marker, gồm identifiers/schema/outputSchema. Điều này giảm nhầm ranh giới, không chứng minh miễn nhiễm prompt injection; runtime policy độc lập mới chặn call không được phép.

Dataset dev được dùng chỉnh prompt. Holdout không dùng sửa prompt; nếu đã xem để chỉnh, chuyển các case đó về dev và tạo holdout mới trước final evaluation. Chi phí gồm query expansion, retrieval embedding nếu có, mọi planning/repair/replan. Không dùng model confidence thay độ đúng.

Replan chỉ local trong B; partial/full helpers là legacy, engine B không được chọn. Kế hoạch thay đổi phải validate và duyệt lại; write unknown không được replan. Tác vụ loop/min/map/tóm tắt không có tool phù hợp phải refusal hoặc clarification theo nguyên nhân.
