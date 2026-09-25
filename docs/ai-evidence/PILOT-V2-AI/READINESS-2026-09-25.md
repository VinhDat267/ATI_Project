# Pilot v2 AI quality — kiểm tra trước phép đo thật

**Trạng thái 25/09/2026:** `AI_QUALITY_NOT_RUN`. Chưa gửi request tới Gemini trong đợt này. Chủ project chọn Gemini với trần **0 USD, chỉ Free Tier**. Không thay nhãn này bằng kết quả test mô phỏng.

## Bằng chứng đã kiểm

- Bộ công khai có 20 ca × vi/en = 40 record; holdout có 10 ca × vi/en = 20 record. Đây là dữ liệu tái dựng, không phải dữ liệu khách hàng.
- Sau khi triển khai cổng đo, `npm run test:unit -w @wap/engine -- tests/pilot-quality-freeze.test.ts tests/pilot-provider-quality.test.ts tests/pilot-quality-journal.test.ts tests/pilot-quality-grader.test.ts tests/pilot-dataset-validation.test.ts` đạt **5 file, 40 test**; ba test đối chứng giá đạt bằng `node --test scripts/pilot-quality-pricing.test.mjs`. Các test vẫn dùng transport giả. Build `@wap/engine` đạt.
- `provider-quality-runner.ts` vẫn giữ đường contract `SIMULATED_ONLY` cũ, đồng thời có đường `fixed-catalog` cho model thật với journal bền vững và không thực thi Trello. CLI chiến dịch `scripts/pilot-ai-quality-campaign.mjs` yêu cầu manifest khóa, `--execute`, xác nhận Free Tier, giá của đúng model, key fingerprint và Git HEAD sạch. Runner P6 cũ đọc oracle và ước lượng usage/cost nên không được dùng làm evidence AI thật.
- Freeze nay cho phép `budget.maxCostMicros: 0` chỉ với attestation Gemini Free Tier hết hạn, key fingerprint và model cố định. Journal giữ reservation trước dispatch, kết quả giải mã đã che credential trước grader, attempt lỗi/không chắc chắn không được tự chạy lại. Lần kiểm đầu không thấy `GEMINI_API_KEY`; sau khi chủ project cấu hình, lần kiểm lại thấy biến ở scope User nhưng chưa ở Process. Chủ project xác nhận project chứa key ở Free Tier và chưa liên kết billing; đây là xác nhận của operator, chưa có phép kiểm độc lập trên AI Studio trong phiên Codex. Chỉ kiểm **sự hiện diện**, không đọc hoặc ghi giá trị key.

## Điều kiện để gọi provider với trần 0 USD

1. Chủ project đặt `GEMINI_API_KEY` ở môi trường local và xác nhận project chứa key đang ở **Free Tier, chưa liên kết billing** trong Google AI Studio. Không gửi key qua chat/repo. Một API key riêng không chứng minh tier hay chi phí.
2. Chọn model có Free Tier được công bố tại [bảng giá Gemini](https://ai.google.dev/gemini-api/docs/pricing), xác minh hạn mức đang áp dụng trong AI Studio; [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) tính theo **project**, không theo API key. Không xoay nhiều key để vượt quota.
3. Tạo manifest sau commit sạch, khóa model `gemini-3.7-flash`, prompt/catalog/behavior, dataset/holdout, rubric, `fixed-catalog`, 60 call, token cap và trần 0 USD. Đường này chưa đánh giá semantic so với semantic+QE.
4. Chạy probe có cap, smoke vi/en cho các nhánh plan/clarification/refusal, rồi bộ công khai và holdout một lần theo manifest đã khóa. Dừng nếu usage thiếu, provider lỗi, sai scope, quan sát không an toàn hoặc mất journal; không retry attempt không chắc chắn.
5. Đối soát journal và chấm tự động sau khi observation đã lưu. Người chấm độc lập phải xem nghĩa của dữ kiện/đáp án; điểm so khớp cấu trúc không đủ cho `AI_QUALITY_MEASURED`. Một probe thành công chỉ chứng minh kết nối/provider shape.

**Điểm dừng hiện tại:** cổng đo mã nguồn và review đã xong; chưa commit/freeze và chưa gửi lời gọi provider. Không dùng kết quả nền B/local hoặc một card Trello đã xác nhận để suy ra quality AI v2.
