# 20/10/2026 · FE-12 · Sửa theo review độc lập lần 1 của #162

**Người viết:** reviewer (bên thi công FE-12). **Nhánh:** `feat/fe-12-shared-nav-bar` (#162), từ head `71bb895`. Task: [FE-12](../tasks/FE-12-shared-nav-bar.md). [Review lần 1](https://github.com/VinhDat267/ATI_Project/pull/162#issuecomment-6287543791) tại `71bb895`: **chưa đạt**, 1 P2 và 1 P3.

## Đã sửa

- **P2: câu yêu cầu liền ký tự làm màn đang thực thi tràn ngang.** Với câu `Tạo issue theo https://example.test/` nối 300 chữ `a`, trang 375 px rộng thành 2.568 px. Dòng "Bạn nhờ" nằm trong cột chữ của `ExecutionMoment`, mà cột này là flex item không có `min-w-0`, nên `break-words` không làm cột hẹp lại được.
  - `ExecutionMoment.tsx`: cột chữ thêm `min-w-0 flex-1`. `min-w-0` cho câu dài xuống dòng; `flex-1` cho cột chiếm phần còn lại, nên ô "Việc 1/2" giữ đúng bề rộng và nằm trên một dòng.
  - Năm chỗ còn lại có dòng "Bạn nhờ" không nằm trong flex item, trừ màn lập kế hoạch lâu, vốn đã có `flex-1 min-w-0`. Test mới đo cả 7 khoảnh khắc (dưới đây).
- **P3: tab lệch tâm ở đầu dải máy tính bảng.** Reviewer đo lại trên app sandbox, cockpit của admin có 12 tin và một kế hoạch chờ duyệt:

  | Khổ | Ba cột của lưới (px) | Tâm tab lệch |
  |---|---|---|
  | 768 | 99,5 · 409,6 · 195,0 | −47,7 px |
  | 800 | 131,5 · 409,6 · 195,0 | −31,7 px |
  | 850 | 181,5 · 409,6 · 195,0 | −6,7 px |
  | 900 | 213,2 · 409,6 · 213,2 | 0 |

  Cụm phải của cockpit rộng 195 px (Lịch sử 40, Xem hội thoại 67, nút sáng/tối 32, avatar 32, ba khoảng 8). Muốn tab ở giữa ở 768 px thì 5 tab rút gọn chỉ được rộng tối đa 314 px, trong khi hiện rộng 410 px. Trang Nhật ký (cụm phải 72 px) đã ở giữa từ 768 px.
  - Reviewer hỏi nhóm trưởng ba cách: hiện tab từ 900 px, giữ mốc 768 px và chấp nhận lệch, hoặc hiện tab từ 1024 px. Ngày 20/10 nhóm trưởng chọn **hiện tab từ 900 px**.
  - `MainNav.tsx`: tab `hidden min-[900px]:flex`, tên trang cạnh logo `min-[900px]:hidden`. Dưới 900 px, thanh dùng bố cục điện thoại ở mọi trang; menu avatar vẫn đủ 7 mục. Chữ rút gọn ở 900–1279 px, chữ đầy đủ từ 1280 px như cũ.
  - Mục 2 của task card ghi mốc mới và lý do.

## Test

- **Test browser mới** `FE-12: a long request without spaces wraps in every cockpit moment and never widens the page`. Test seed 7 hội thoại có cùng câu dài trong PostgreSQL tạm: khoảnh khắc 4 (chờ duyệt), 5 (giữ lệnh duyệt như `fe-05b-parity-b`), 6, 7, 8, 9 và kết thúc không thành công. Ở 375 và 1.024 px, test kiểm:
  - trang không cuộn ngang;
  - dòng "Bạn nhờ" không rộng hơn khung của chính nó;
  - tiêu đề nằm trong màn hình;
  - ô đếm bước nằm trong màn hình và trên một dòng.
- **Test bố cục** đo thêm 900, 899 và 768 px (bỏ 800), và kiểm tab ở giữa ở mọi khổ có tab, không chỉ từ 1.024 px. Dưới 900 px kiểm không có tab và trang con có tên trang.
- **RED** trên mã `71bb895`, sau khi viết test (lúc đó test bố cục đo 800 và 768 px): 2/2 fail.
  - `moment 5 at 375: no sideways scroll`: 2.568 so với 375, đúng số của review;
  - `800 light: tabs centred`: 31,7 px.
- **GREEN:** câu dài 1/1 sau khi sửa P2; cả 5 test `FE-12:` đạt sau khi sửa P3.
- **Đột biến** (sửa từng chỗ, chạy test liên quan, khôi phục): **4/4 bị bắt**.
  - R1 tab lại hiện từ 768 px: fail `899 light: tabs hidden on phones`;
  - R2 tên trang ẩn từ 768 px: fail ở kiểm tên trang dưới 900 px;
  - R3 bỏ `min-w-0`: fail `moment 5 at 375: no sideways scroll`;
  - R4 bỏ `flex-1`: fail `moment 5 at 375: step counter stays on one line`.

## Kết quả kiểm

PostgreSQL 16 tmpfs riêng ở 55533, sandbox, hai cờ tắt, không dùng `.env` hay DB dev.

- `npm run check`: **exit 0**, **2.042 v3** (63 + 408 + 291 + 42 + 465 + 773 web) **+ 389 eval**. Số không đổi vì không thêm test unit.
- `npm run test:browser:v3`: **exit 0** ngay lượt đầu, **120 pass, 1 skip có chủ đích, 13 nhóm** (default 93 pass/1 skip). Tăng 1 so với 119 của `71bb895`, là test câu dài mới.
- `git -c core.whitespace=cr-at-eol diff --check` đạt.

## Không đổi

- Bộ ảnh trước/sau ngày 19/10 (1440/1024/375) vẫn đúng: thay đổi về mốc chỉ ảnh hưởng 768–899 px, và màn đang thực thi không có trong bộ ảnh. Test bố cục chụp mọi khổ nó đo, cả 900/899/768 px, và in SHA-256 của từng ảnh ra log của lượt chạy.
- Không đổi test unit; `fe-12-main-nav.test.tsx` không kiểm mốc độ rộng.

## Chưa làm

- Khoảnh khắc 3 (hỏi lại) và màn lập kế hoạch lâu không có trong test câu dài. Ở hai màn này, dòng "Bạn nhờ" nằm trong khối dọc, hoặc trong flex item đã có `min-w-0`. Seed chúng cần dựng tin hỏi lại hoặc giữ một lượt lập kế hoạch đang chạy.
