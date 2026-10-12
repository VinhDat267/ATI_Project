# 12/10/2026 · W4-00 · Model dự phòng qua 9router

- Task: [W4-00](../tasks/W4-00-llm-fallback-provider.md).
- Worktree riêng `w4-00-llm-fallback`, nhánh `codex/w4-00-llm-fallback`, base `305302b`.
- Chọn `cx/gpt-6.1-sol`, served `gpt-6.1-sol`; source/labels/prompt/catalog không đổi. Chỉ bốn file tài liệu thuộc task; không sửa CURRENT-STATE/ROADMAP.
- Probe ba ứng viên, tám câu chung mỗi model: `gpt-5.6-luna` 8/8, `gpt-6-luna` 8/8, `gpt-6.1-sol` 7/8. Model Luna nhanh hơn nhưng phép đo đầy đủ bộc lộ tham chiếu dưới dạng chuỗi chưa được resolve; giữ cả các kết quả thấp.
- Full Luna: core cùng 45/50; services 38/44 (`5.6`) và 36/44 (`6`). Model được chọn: core 48/50 **partial**, services 41/44 complete. [Báo cáo](../../ai-evidence/V3-GOLDEN-V2/W4-00-REPORT.md) ghi từng failed case, mẫu số, hash source/label và các giới hạn.
- Core timeout `cl04` ở cả hai lần 30 giây; runner hủy `rf07` đang chạy, exit 2. Không gọi là campaign hoàn chỉnh hoặc đóng gate latency core. Fresh completion mới đạt trong 2,735 s; sau đó services chạy riêng 44/44, exit 0, tool 96,4%, argument 96,3%, p95 9,408 s, không timeout; năm service mới đều đạt ngưỡng.
- Provider test hiện có 19/19, native HTTP fault probe 5/5: 429/503 retry thật qua socket, 503 liên tục dừng sau ba request, served model khác bị chặn, timeout thực đóng kết nối. Không thêm alias/nới timeout, không thay model tự động.
- `npm run check` trên source `305302b`, PostgreSQL riêng: exit 0, 1.674 v3 + 173 eval; typecheck/build/build-security/launcher 1/1/env-OIDC 10/10 đạt.
- App live bằng `npm run up`, PostgreSQL tmpfs riêng: model `cx/gpt-6.1-sol`, health live, Chromium thật tới preview 6,033 s, Hủy → plan rejected, toàn DB preview 0 execution steps, 0 request approve. Gateway request/served/JSON mode đã quan sát. Không có lệnh ghi GitHub.
- Lượt app đầu (`5.6-luna`) đã hủy plan nhưng assertion toàn DB fail vì còn ba row fixture từ check; lượt nghiệm thu dùng database mới. Một lần preload lỗi scheme Windows trước khi API chạy, sửa file URL trong helper ignored. Giữ log/ảnh/báo cáo của các lượt này; không sửa product để che lỗi.
- Runbook trong `evaluations/README.md`: chuyển bằng environment, khởi động lại, quay về Gemini, kiểm startup/health, không trộn model trong campaign, quota unknown, data scope và rủi ro chung 9router. `.env` gốc/bản riêng SHA-256 không đổi.
- Bằng chứng riêng sao chép về `docs/ai-evidence/V3-LIVE-EXECUTION/W4-00-2026-10-12/` tại repo chính, ignored, manifest SHA-256; không commit ảnh/raw reports/credentials.
- Chưa làm: campaign core hoàn chỉnh của model được chọn, model dự phòng ghi thật, các gate W3-11/W4-01–04, xử lý khi gateway/host hỏng. Chờ review độc lập và CI đúng head trước khi nghiệm thu/merge.
