# 14/10/2026 · Review và merge #137 (W4-00b), ghi #138

**Người viết:** reviewer · **Nhánh:** `docs/record-137-138` · Chỉ tài liệu.

## Merge

| PR | Nội dung | Head đã kiểm | Merge | Giờ (Việt Nam) |
|---|---|---|---|---|
| [#138](https://github.com/VinhDat267/ATI_Project/pull/138) | Đặc tả Gmail và kiểu "trả lời", 6 task card | `8a91240` | `6185b2c` | 14/10 10:03:20 |
| [#137](https://github.com/VinhDat267/ATI_Project/pull/137) | W4-00b, `longnguyen005` | `345b2c8` | `ebc192d` | 14/10 10:15:57 |

- Cả hai merge theo lệnh "merge #N" của nhóm trưởng, khoá theo head (`--match-head-commit`). CI PR xanh đúng từng head.
- Cây `6185b2c` bằng cây `8a91240`. Cây `ebc192d` bằng cây `345b2c8` cộng đúng 11 file tài liệu của #138; `git diff 6185b2c ebc192d` chỉ có 5 file của #137.

## Review #137

Kết luận **Đạt**, không có P1/P2/P3. [Bình luận review](https://github.com/VinhDat267/ATI_Project/pull/137#issuecomment-6160075930).

- Đọc diff và đối chiếu `packages/executor/src/resolver.ts`: executor chỉ thay giá trị trong `$ref`/`$template`, nên lỗi của task card là có thật. Bản sửa chặn ở validator, trước khi người dùng thấy bản xem trước.
- Danh sách câu người dùng (`userTexts`) được tính một lần trước lượt thử lại, ở cả `processMessage` và `planWithSearch`. Câu lỗi gửi lại cho model không làm lượt thử lại được chấp nhận.
- Chạy ở máy: worktree riêng tại `345b2c8`, `npm ci`, PostgreSQL 16 tmpfs riêng ở 55533, `RUNTIME_MODE=sandbox`, không dùng `.env`.
  - Test planner trọng tâm 89/89, exit 0.
  - 8 đột biến mới (khác 3 đột biến của người thi công), 8/8 bị bắt, mã nguồn khôi phục sau mỗi lần:
    - bỏ chỗ bỏ qua wrapper một khoá;
    - bỏ `\b` sau `.output`;
    - một placeholder người dùng gõ cho qua cả chuỗi;
    - bỏ qua khác biệt khoảng trắng;
    - báo lớp `schema` thay vì `semantic`;
    - tính câu lỗi của lượt thử lại là câu người dùng;
    - câu lỗi thiếu đường dẫn tham số;
    - step id không nhận dấu gạch ngang.
  - `npm run db:migrate:v3` rồi `npm run check`: exit 0, 1.699 v3 (47 + 340 + 237 + 25 + 371 + 679) + 173 eval, typecheck, build, quét bản build, launcher 1/1, env/OIDC 10/10.
  - Không chạy browser ở máy. [CI #137](https://github.com/VinhDat267/ATI_Project/actions/runs/38350079490) chạy check và browser đúng head: 101 pass, 1 skip có chủ đích, 11 nhóm.
- Ghi chú không chặn: `evaluations/live-execution/harness.ts:81` kiểm lại plan mà không có grounding, nên placeholder người dùng gõ sẽ bị `run.ts` từ chối. Đúng quy tắc của task card.
- DB tạm và worktree review đã xoá sau khi chạy.

## Cập nhật bàn giao

- `CURRENT-STATE.md`: đầu file, mục 3 (số liệu sau #137, bảng test), mục 4 (#137, #138); bỏ dòng lỗi validator ở mục 5 vì đã sửa.
- `ROADMAP.md`: W4-00b xong; ANS-01 bắt đầu được; đoạn "Cập nhật 14/10".
- Task card W4-00b: trạng thái xong.

## Chưa kiểm

- CI `main` sau #137 (`ebc192d`) đang chạy khi viết log này. CI `main` sau #138 SUCCESS.
- Không gọi model. Phép đo tham khảo `EVAL_ONLY=cs03,cs04,ca03,ji03` với `cx/gpt-5.6-luna` chưa chạy, do nhóm trưởng chạy khi có 9router.
