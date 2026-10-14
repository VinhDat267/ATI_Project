# 13/10/2026 · Kế hoạch Gmail theo kết nối riêng và kiểu "trả lời"

**Người viết:** reviewer (vai trò lập kế hoạch) · **Nhánh:** `docs/gmail-personal-connections-spec` · Chỉ tài liệu.

## Việc đã làm

- Đặc tả [`2026-10-13-gmail-personal-connections-design.md`](../../superpowers/specs/2026-10-13-gmail-personal-connections-design.md):
  - bản 1 viết theo các mục nhóm trưởng duyệt từng phần;
  - review độc lập cùng ngày kết luận "chưa đạt" với 17 điểm. Nhóm trưởng chọn hai quyết định: (A) Google Cloud project riêng cho Gmail; (B) cờ `GMAIL_ENABLED` tắt mặc định;
  - bản 2 sửa cả 17 điểm (mục 10 của đặc tả);
  - nhóm trưởng trả lời hai câu còn mở: chấp nhận nội dung thư đi qua 9router tới tài khoản model bên thứ ba và được giữ trong hội thoại; chia việc giữa nhóm trưởng và `longnguyen005`;
  - mục 11 ghi các chỗ chỉnh khi viết task card.
- Task card: [GMAIL-common](../tasks/GMAIL-common.md) (quy tắc chung, chỗ nối giữa các task, các ca dễ bị bỏ sót), [GMAIL-01](../tasks/GMAIL-01-personal-connection.md), [GMAIL-02](../tasks/GMAIL-02-gmail-tools.md), [ANS-01](../tasks/ANS-01-read-answers.md), [GMAIL-03](../tasks/GMAIL-03-gmail-ui.md), [GMAIL-04](../tasks/GMAIL-04-measure-and-live.md).
- `ROADMAP.md`: 5 dòng mới, đoạn "Cập nhật 13/10 (Gmail)". `CURRENT-STATE.md` mục 7: "Chốt 13/10/2026" và thêm `docs/ai-evidence/GMAIL-LIVE/` vào danh sách không commit. `.gitignore` ignore thư mục đó (đã kiểm bằng `git check-ignore`).

## Chia việc

| Người | Task |
|---|---|
| nhóm trưởng | GMAIL-01 (18/10), GMAIL-02 (21/10), Google Cloud project (21/10), GMAIL-04 (26–28/10) |
| `longnguyen005` | W4-00b (đang làm), ANS-01 (21/10), GMAIL-03 (23/10) |

Lý do:
- Nhóm trưởng giữ phần cần Google thật, 9router và máy của mình.
- GMAIL-01 và GMAIL-02 nối tiếp nhau trên cùng file nên để một người.
- ANS-01 không phụ thuộc Gmail và sửa tiếp `validator.ts` sau W4-00b. GMAIL-03 là giao diện, như FE-10/FE-11.

## Chỉnh so với đặc tả đã duyệt (mục 11 của đặc tả)

- Executor không đổi interface; tham chiếu kết nối đi qua `AdapterFactory.getAdapterForService(serviceName, context)`.
- Sau PR bật cờ, không đặt `GMAIL_ENABLED` nghĩa là "bật khi đủ cấu hình". Nếu không, đổi mặc định sang `on` sẽ làm mọi máy live chưa cấu hình Gmail không khởi động được.
- `GET /api/health` thêm `gmailEnabled` cho `/privacy`, `/guide`, Landing (trang công khai không gọi được `GET /api/services`).
- GMAIL-04 đo thêm một lượt core và một lượt services với `PLANNER_READ_ANSWERS=on`, vì cờ này đổi quy tắc 0 của prompt cho mọi câu.
- ANS-01 dời lên 21/10, GMAIL-03 sang 23/10.

## Chưa kiểm

- Chỉ chạy `git diff --check` và `git check-ignore`. Không chạy test, không gọi model hay Google.
- Các tên hàm và file trong task card đọc từ mã trên `main` `3b60c28`. Người thi công kiểm lại khi bắt đầu, nhất là sau khi W4-00b merge.
