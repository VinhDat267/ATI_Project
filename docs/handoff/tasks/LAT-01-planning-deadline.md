# LAT-01 · Model suy nghĩ quá deadline 30 s (tuỳ chọn)

**Trạng thái:** **chỉ làm nếu nhóm trưởng chọn làm trước 29/10**; mặc định không làm (FINISH-PLAN mục 4) · **Nhánh gợi ý:** `fix/lat-01-planning-deadline` · **Phụ thuộc:** 9router; bộ W4-01 · **Mốc:** merge trước 04/11/2026
**Bối cảnh:** CURRENT-STATE mục 5, dòng "Model suy nghĩ quá deadline 30 s"; báo cáo W4-01 (`docs/ai-evidence/V3-GOLDEN-V2/2026-10-24-W4-01-REPORT.md`).

## Vấn đề

- `OpenAICompatibleProvider` (`packages/planner/src/providers/openai-compatible-provider.ts`) đặt `timeoutMs` mặc định 30.000 ms cho mỗi lần thử, và thử lại một lần khi quá hạn (`timeoutRetries: 1`).
- Ở W4-01 (24/10), `gemini-3.8-flash-n` có lúc suy nghĩ 3.800–4.800 reasoning token (35–45 s), nên 17/124 lần thử ở `llm` quá hạn và 4 câu bị chấm trượt.
- Trên app, người dùng chờ khoảng 60 s rồi nhận lỗi lập kế hoạch.

## Chọn một hướng (nhóm trưởng chọn, ghi vào log)

| Hướng | Làm gì | Rủi ro |
|---|---|---|
| A | Tăng `timeoutMs` lên 45.000 ms, đặt qua biến môi trường (`LLM_TIMEOUT_MS`, mặc định giữ 30.000 cho tới khi đo xong), giữ một lần thử lại | Ca xấu nhất chờ ~90 s; màn "lập kế hoạch lâu" (15 s) vẫn cho "Thôi chờ" |
| B | Giảm thời gian suy nghĩ ở gateway: alias hoặc tham số của 9router, nếu có | Có thể giảm chất lượng; phải đo lại các bộ golden |
| C | Không đổi mã, chỉ ghi giới hạn vào báo cáo (mặc định) | — |

## Việc cần làm (hướng A hoặc B)

1. **Đối chứng cùng ngày trước khi sửa:** chạy W4-01 `llm` ×1 trên `main`, ghi số lần thử quá hạn.
2. **TDD:**
   - test provider với `timeoutMs` từ cấu hình, kiểm bằng `AbortSignal` thật (máy chủ giả trả chậm hơn deadline cũ, nhanh hơn deadline mới);
   - test `validateEnv` cho biến mới (thiếu, hợp lệ, sai);
   - giá trị mặc định không đổi hành vi khi chưa đặt biến.
3. **Đo lại cùng ngày:** W4-01 `llm` ×1, `core` ×1, `services` ×1 với giá trị mới.
4. **Quy tắc nhận:**
   - số lần quá hạn giảm;
   - không bộ nào thấp hơn đối chứng cùng ngày quá 2 câu;
   - p95 ghi rõ trong báo cáo.

   Không đạt thì đóng PR, giữ hướng C.
5. **Báo cáo** `docs/ai-evidence/V3-GOLDEN-V2/<ngày>-LAT-01-REPORT.md`, theo khuôn W4-01.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; timeout kiểm bằng `AbortSignal` thật.
- [ ] Đối chứng và đo lại cùng ngày, cùng model; báo cáo có nguồn gốc từng lượt.
- [ ] `npm run check`, `npm run test:browser:v3` exit 0.
- [ ] Merge trước 04/11, hoặc đóng PR và ghi lý do.

## Kết quả (agent thi công điền)

- Hướng đã chọn:
- PR:
- Số đo:
