# 27/10/2026 · Review và sửa #177 (bàn giao SCHED-03)

**Yêu cầu:** review và fix nốt [#177](https://github.com/VinhDat267/ATI_Project/pull/177). Đây là PR ghi bàn giao sau merge; không có task card thi công riêng. **Nhánh:** `docs/record-171`, worktree riêng `ATI_Project-wt-record171`, sạch trước khi làm.

## Phạm vi và kết quả review

- Đọc diff `f4ff636..45ced11a`, checklist review, log merge và task card SCHED-03/SCHED-04; đối chiếu FINISH-PLAN cùng thông tin GitHub hiện tại.
- #171 đã merge lúc 06:51:36Z ngày 27/10 ở `f4ff636`; #174 ở `88791d9`, #175 ở `2888a9f` ngày 26/10. Cây `ec2df5a` và `f4ff636` cùng mã `a6bfc862a40ebaf76c85388af765cff9f95acb86`.
- [CI #171](https://github.com/VinhDat267/ATI_Project/actions/runs/40462770139) SUCCESS đúng `ec2df5a`; [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/40463609040) SUCCESS đúng `f4ff636`; [CI #177 ban đầu](https://github.com/VinhDat267/ATI_Project/actions/runs/40464910835) SUCCESS đúng `45ced11a`.
- Đọc lại output CI main và log cục bộ đã lưu ở `ATI_Project/.codex/worktree-archive/2026-10-27-review-pr171/review-171/`: **2.261 v3 + 394 eval**, browser **149 pass/1 skip, 14 nhóm** khớp tài liệu. Lượt browser cục bộ đầu tiên fail AUTH-04, lượt chạy tiếp từ `auth04` đạt; giữ nguyên phân biệt này trong bàn giao.

## Các điểm đã sửa

1. **P2 · CURRENT-STATE, việc tiếp theo:** câu OAUTH-02 "chưa có PR" sai. [#176](https://github.com/VinhDat267/ATI_Project/pull/176) mở lúc 06:28:39Z ngày 27/10, trước commit `45ced11a`. Cập nhật CURRENT-STATE và ROADMAP thành đang review, chưa merge; vẫn giữ mốc quyết định phạm vi bảo vệ 29/10.
2. **P3 · CURRENT-STATE, số liệu #171:** bỏ tuyên bố toàn bộ phép kiểm không gọi dịch vụ thật. Hai ca FE-07 kiểm kết nối Notion dùng token giả nhưng gọi provider thật, được ghi ngay trong `apps/chat-web/tests/browser/fe-07-settings.spec.ts` và đi qua `services-routes.ts` → transport Notion. Ghi rõ fixture Google/Gmail, ngoại lệ Notion và nghiệm thu SCHED-04 chưa chạy.
3. **P3 · CURRENT-STATE và ROADMAP, mốc SCHED-04 mới thêm:** sửa "merge trước 30/10" thành "merge ngày 30/10, trước 31/10 theo task card", khớp lịch ngày 30/10 trong FINISH-PLAN và mốc của SCHED-04; không tự dời hạn sớm một ngày.

## Kiểm tra trong phiên này

- Đối chiếu metadata GitHub, SHA head/base/merge, trạng thái CI và output CI; kiểm tra tổng số test và số nhóm browser.
- Kiểm tra **282 liên kết tương đối trong bốn file của PR**, UTF-8 không BOM/LF và `git diff --check`: đều đạt, exit 0.
- Không chạy lại test ứng dụng tại máy trong phiên sửa tài liệu. Không đổi code, test, prompt, label, cờ hay kết quả đo; CI của commit sửa được theo dõi ở [checks #177](https://github.com/VinhDat267/ATI_Project/pull/177/checks).
- Nghiệm thu model/dịch vụ thật của SCHED-04: **NOT_RUN**, thuộc task SCHED-04. Review nội dung mã của #176 nằm ngoài phạm vi #177.

**Bằng chứng phiên này:** `.codex/review-pr177/` trong worktree, không commit log CI thô. PR #177 chưa được merge trong phiên này.
