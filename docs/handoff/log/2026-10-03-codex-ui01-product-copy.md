# UI-01 · Nội dung hướng đến sản phẩm · 03/10/2026

## Phạm vi

Chủ dự án thấy nhiều chữ giống demo/test và yêu cầu xóa hoặc viết lại để giống website vận hành. Đọc state/README/ba log mới nhất và status/log; Frontend_UXUI HEAD995f5f7, dirty files đều là các lượt card hover/mini/reveal của phiên này, không công việc của agent khác. Tiếp tục UI-01 và giữ nguyên các thay đổi đó. Chỉ frontend v3/docs task; không backend/v2/dependency/CURRENT-STATE/ROADMAP/commit/push/deploy hoặc dịch vụ thật.

## Thay đổi

- Landing: hero “Ví dụ quy trình”, nhóm how một nhãn “VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC”, bỏ Minh họa lặp ở từng preview; tên truy cập Ví dụ về … còn nguyên. Tài nguyên frontend/web-app thay ati-demo/web-app; chat nêu Trello để khớp workflow ba bước. Dải kết quả Công việc đã được kết nối thay Hoàn tất quy trình mẫu. Nhãn ví dụ không bỏ hoàn toàn, không giả plan/result thật.
- Login: bỏ khối quảng bá đăng ký/quên mật khẩu/Google đang phát triển. Không thêm nút/đường dẫn không hoạt động. Sidebar bỏ dòng Quản lý tài khoản · Roadmap; dịch vụ/gợi ý có copy tự nhiên ngắn hơn.
- Services: intro/hướng dẫn lưu→kiểm tra ngắn; quyền quản trị/thông tin dùng chung ở modal thay mô tả server/storage. Scope bỏ Allowed Scope bằng tiếng Anh. Trạng thái configured/check giữ nguồn API. Empty state Chưa có dịch vụ nào khả dụng; lỗi vẫn tách khỏi empty.
- Roadmap landing/services gọi Dự kiến và nói chưa khả dụng. Không hứa ngày phát hành hay nói đang phát triển khi mới có kế hoạch; nhóm active/planned vẫn riêng.
- RuntimeNotice nhận mode cấu hình do App truyền: live không banner thường trực, sandbox một dòng thử nghiệm/xác nhận môi trường, unknown vẫn cảnh báo. Không đổi RUNTIME_MODE/Vite/proxy/env để giả live. Backend health chưa trả mode, không claim xác minh backend.
- userError chỉ dịch fallback chính xác Request failed with status502/503/504 sang Tạm thời không thể kết nối đến máy chủ. Không thay status hoặc lỗi nghiệp vụ có nội dung cụ thể; không thêm retry ghi hoặc sửa recovery.
- Palette/font/bố cục/hover/scroll reveal/hero/marquee và hợp đồng API/SSE giữ nguyên. CSS chỉ bỏ selector của nhãn preview không còn dùng; không thêm thư viện.

## Kiểm chứng

- Thử vi.stubEnv trong App ban đầu không đổi được giá trị define của Vite; harness đó đã gỡ sạch, app-auth.test.tsx không còn diff. Tách RuntimeNotice khỏi App để kiểm định các mode thực truyền vào component, không đổi cách đọc cấu hình của ứng dụng.
- RuntimeNotice giữ bản markup/copy cũ trước test: exit1,2 failed/3 passed (live vẫn hiện banner, sandbox thiếu copy môi trường). Sau sửa behavior PASS. Gateway test trước sửa: exit1,3 failed/1 passed; sau sửa PASS. Đây là kiểm copy/render frontend, không chứng nhận API runtime hoặc backend concurrency.
- npm run test -w @wap/chat-web cuối: exit0,29 files/173 tests PASS,3.53s. Các assertion copy cũ của landing/login/services cập nhật theo wording mới; vẫn kiểm CTA, roadmap/Escape, cấu hình/check riêng và list error/empty.
- npm run build -w @wap/chat-web cuối: exit0 TypeScript/Vite8.3.0,1916 modules,461ms; CSS82.01kB/gzip17.51, main312.56kB/gzip97.43, services7.70kB/gzip2.81. Diff-check PASS.

## Browser và giới hạn

CUA5175: landing desktop1440×900/mobile390×844, không nhãn Minh họa/quy trình mẫu trong từng preview; nội dung/resource đủ, mobile scrollWidth375≤390. Nút Dự kiến mở inline active/planned và disclaimer mới, Escape đóng. Hero/marquee/reveal vẫn có, không kiểm lại mọi động tác drag vì logic không sửa và toàn bộ regressions PASS.

Phiên đăng nhập cũ vẫn có token; /?view=login hiện workspace theo hành vi sẵn có. Không logout/xóa storage của người dùng để ép QA form. Workspace/services render copy mới và nhãn thử nghiệm; proxy API trả502, chưa kết nối được máy chủ API, thông báo đã thành tiếng Việt. Không tự restart backend hoặc giả API; không xác minh login thành công, service card từ server hoặc save/check bằng browser trong lượt này. Các phần đó được kiểm bằng regression/frontend fixtures rõ ràng; không gọi thao tác ghi thật. Runtime live/no-banner kiểm qua component tests, không chuyển preview thành live.

Ảnh ngoài repo: C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/product-copy-desktop.jpg và product-copy-mobile.jpg. Giữ preview cuối landing#how, reset viewport override.

FE-01/02/03, tài khoản và năm dịch vụ dự kiến không đóng. Chưa CI/review độc lập/PR/commit/push/deploy thay đổi mới.
