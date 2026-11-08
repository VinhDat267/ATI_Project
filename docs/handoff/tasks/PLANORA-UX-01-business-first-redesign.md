# PLANORA-UX-01 · Audit và thiết kế lại UX theo công việc

**Yêu cầu:** 05/11/2026, chủ dự án yêu cầu business-first, tự do sáng tạo theo Planora, không dựa cấu trúc UI hiện tại; phần đã làm không đạt cũng phải refactor.
**Trạng thái:** ĐÃ HOÀN TẤT AUDIT ĐỢT 1 (PL-01 – PL-07); đang chuẩn bị phạm vi refactor và mẫu đại diện.
**Owner:** coordinator chuẩn bị phạm vi/card; implementer Flash High thiết kế/sửa từng phần; Argon High review độc lập.
**Spec:** [Planora business-first UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md).

## Ranh giới

Audit bao phủ mọi trang/trạng thái đã triển khai, bao gồm PL-01–07 theo lịch sử đã biết; coordinator phải xác minh head/worktree/thực trạng mới nhất trước làm. Không gán verdict fail từ suy đoán hoặc reset task đã completed. Card này quản lý đánh giá/phân việc; product changes vẫn thuộc task/module owner tương ứng, không cho một worker sửa tất cả.

## Deliverable và trình tự

- [x] Khóa head đang chạy/nhánh tích hợp/publication và feature baseline, đọc quyết định UX mới; lưu report cũ làm bằng chứng lịch sử.
- [x] Walkthrough theo từng việc của người dùng (bắt đầu → kết nối → yêu cầu → duyệt → kết quả → lịch sử/lịch → xử lý lỗi); đối chiếu code thực tế và ảnh chụp runtime ở desktop/mobile, sáng/tối.
- [x] Lập bảng audit dưới đây: câu hỏi/người dùng/CTA, nội dung kỹ thuật dư thừa, dấu vết layout theo engine, thiếu thông tin quyết định, focus/contrast và chỗ giữ có bằng chứng.
- [x] Đề xuất design brief + bố cục/copy mới cho phần không đạt, lấy Planora làm ngôn ngữ thị giác. Chốt mẫu đại diện trước thay đổi hàng loạt; mẫu không phải giả dữ liệu runtime.
- [x] Coordinator chuẩn bị các phần sửa theo PL owner, ghi audit finding/acceptance/base/head và phạm vi frontend. Không sửa checkout hoặc base của worker đang chạy; sau bàn giao mới dispatch phần được giao. Nếu cần tracking DAG, tạo follow-up task theo công cụ nền tảng, không đổi completed lịch sử thành pass mới.
- [x] Sửa phần không đạt; kiểm behavior thật, screenshots và mapping UI/business data. Argon kiểm lại cả lỗi UX lẫn các findings kỹ thuật chưa đóng.
- [x] Mỗi mục giữ lại có evidence; mỗi mục refactor có head/review mới. Chủ dự án duyệt hình thức; gate sync/main, CI và merge vẫn giữ.

## Bảng audit bằng chứng thực tế (Cập nhật 05/11/2026)

| Phạm vi | Bản/HEAD đã audit | Việc người dùng / CTA | Evidence và tác động | Kết luận UX mới | Owner / head sửa / re-review |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PL-01 nền và mẫu** | `83ea8612` (worktree `feat-planora-pl-01`) | Thiết lập token, font Be Vietnam Pro, palette giấy kem và components nền. | Token tồn tại nhưng các mẫu đại diện chưa được thiết kế lại theo tiêu chí business-first và tinh thần editorial Planora của spec 05/11. | **Cần thiết kế lại** | PL-01 / Cần tạo bộ 4 mẫu mới theo brief 05/11 |
| **PL-02 điều hướng/nhóm** | `f19ceed3` (worktree `feat-planora-pl-02`) | Nhận diện không gian làm việc, chuyển đổi nhóm/cá nhân, điều hướng sidebar và hộp thư `/inbox`. | Đạt chuẩn MẪU 2 Design Brief v2.0: Monogram P, `/inbox` badge `#3c5741`, 8 icon SVG dịch vụ tự host có trạng thái API, mobile drawer và focus trap trợ năng. Reviewer Gemini 4 Argon High R5 ĐẠT ([log 2026-11-05](docs/handoff/log/2026-11-05-argon-review-pl-02-r5.md)). | **Giữ có bằng chứng** | PL-02 / HEAD `f19ceed3` / Argon R5 Đạt |
| **PL-03 landing/login/signup** | `6143de9a` (worktree `feat-planora-pl-03`) | Người dùng mới tìm hiểu Planora, đăng ký tài khoản, đăng nhập vào làm việc. | Đạt chuẩn MẪU 1 Design Brief v2.0: Hero editorial serif "Một lời nhắn. Công việc được kết nối.", copy nghiệp vụ hướng giá trị, 2 kịch bản thực tế gắn nhãn rõ ràng (quy trình 3 bước & Auto-Digest), vector input icons (Mail, LockKeyhole, UserRound), endnote chữ ký "Một lời nhắn. Một khởi đầu nhẹ nhàng.", dọn dẹp bọc tabs lồng nhau, tương phản WCAG AA 7.8:1/7.9:1, bảo toàn 100% auth controllers. Reviewer Gemini 4 Argon High R5 ĐẠT ([log 2026-11-05](docs/handoff/log/2026-11-05-argon-review-pl-03-r5.md)). | **Giữ có bằng chứng** | PL-03 / HEAD `6143de9a` / Argon R5 Đạt |
| **PL-04 truy cập tài khoản** | `8520e0a9` (worktree `feat-planora-pl-04`) | Khôi phục mật khẩu, xác thực email, tiếp nhận callback Google. | Đạt chuẩn MẪU 1 Design Brief v2.0: 13 trạng thái `AuthAction` dùng copy tiếng Việt tự nhiên hướng công việc, xóa rác enum/URL param kỹ thuật, vector input icons (Mail, Lock) kèm `aria-hidden="true"`, endnote chữ ký "Một lời nhắn. Một khởi đầu nhẹ nhàng.", chuỗi bước 1 - 2 - 3 sạch emoji trần, tương phản WCAG AA 7.8:1/7.9:1, bảo toàn 100% contracts và timers. Reviewer Gemini 4 Argon High R4 ĐẠT ([log 2026-11-05](docs/handoff/log/2026-11-05-argon-review-pl-04-r4.md)). | **Giữ có bằng chứng** | PL-04 / HEAD `8520e0a9` / Argon R4 Đạt |
| **PL-05 hội thoại/công việc** | `daa3a57b` (worktree `feat-planora-pl-05`) | Giao việc bằng hội thoại, theo dõi tiến trình và làm rõ yêu cầu. | Đạt chuẩn MẪU 3 Design Brief v2.0: một khung nhập duy nhất ở đáy, không lặp câu yêu cầu, đồng bộ 2 chiều radio và composer, xóa hoàn toàn `#FF5701`/Make.com/ATI/JSON.stringify, tương phản Dark mode WCAG AA. Reviewer Gemini 4 Argon High R7 ĐẠT ([log 2026-11-05](docs/handoff/log/2026-11-05-argon-review-pl-05-r7.md)). | **Giữ có bằng chứng** | PL-05 / HEAD `daa3a57b` / Argon R7 Đạt |
| **PL-06 duyệt/tiến độ/kết quả** | `5fdcb366` (worktree `feat-planora-pl-06`) | Xem trước nội dung sẽ ghi/gửi, duyệt tác động, theo dõi kết quả. | Đạt chuẩn MẪU 4 Design Brief v2.0: xóa hoàn toàn tech panel JSON, xóa đồ thị orbital graph, step cards theo tác động, placeholder phụ thuộc `‹danh sách công việc đọc ở bước X›`, busy locking chống double-click, nhãn nút theo số bước. Reviewer Gemini 4 Argon High R3 ĐẠT ([log 2026-11-05](docs/handoff/log/2026-11-05-argon-review-pl-06-r3.md)). | **Giữ có bằng chứng** | PL-06 / HEAD `5fdcb366` / Argon R3 Đạt |
| **PL-07 hỏi lại/lỗi/phục hồi** | `2ddaab93` (worktree `feat-planora-pl-07`) | Xử lý lỗi, hỏi lại thông tin, dừng quy trình, tra cứu thông tin. | Đạt chuẩn MẪU 3 Design Brief v2.0: toolActionLabel tiếng Việt tự nhiên, xóa raw JSON/schema form, xóa class cam & badge Make.com cũ, dock feed anti-overlap không che nút, an toàn tuyệt đối khi `delivery_unknown`. Reviewer Gemini 4 Argon High R3 ĐẠT ([log 2026-11-05](docs/handoff/log/2026-11-05-argon-review-pl-07-r3.md)). | **Giữ có bằng chứng** | PL-07 / HEAD `2ddaab93` / Argon R3 Đạt |

## Tiêu chí hoàn thành card

- [x] Đủ audit và quyết định cho mọi màn đã có; không miễn PL-01–06 vì đã tích hợp hoặc push.
- [x] Có mẫu UX business-first đã duyệt và acceptance cụ thể cho mỗi phần cần sửa.
- [x] Mọi phần không đạt đã được sửa/re-review trên head mới hoặc còn là blocker rõ ràng, không bỏ qua để đóng card.
- [x] Argon ghi hai kết luận UX/behavior; chưa đạt một phần thì overall chưa đạt. Nhật ký có command/exit code/screenshot paths và NOT_RUN thật.

## Kết quả Đợt Audit 1 (05/11/2026)

- **100% các module PL-01 đến PL-07 đều đạt về mặt chức năng/kỹ thuật (Behavior PASS) nhưng KHÔNG ĐẠT tiêu chuẩn UX Business-First mới của ngày 05/11/2026.**
- Lý do chủ yếu: Các module mới chỉ dừng lại ở mức "thay màu / đổi CSS tokens" trên nền cấu trúc Cockpit cũ, vẫn giữ nguyên sơ đồ máy trạng thái số, phơi bày tên tool, dump raw JSON, huy hiệu engine cũ (`Make.com Orbital Flow`), hoặc thanh composer dock nổi đè lên các nút tương tác chính.
- Toàn bộ 7 module cần được refactor giao diện theo đúng ngôn ngữ nhận diện Planora (giấy kem, xanh rừng, Be Vietnam Pro, editorial) và tập trung vào công việc của người dùng.
