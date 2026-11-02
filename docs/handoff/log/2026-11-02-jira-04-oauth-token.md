# JIRA-04 OAuth identity và token transport — 2026-11-02

- **Task:** `docs/handoff/tasks/JIRA-04-oauth-token.md`
- **Branch:** `longnguyen005/jira-04-oauth`
- **Code commit:** `61a9e44`; planning commit `f5d9340`. PR chờ review của chủ dự án; không tự merge.
- **Triển khai:** Migration Jira OAuth và allowlist cho runner lặp, client 3LO hai pha, repository token mã hóa, route kết nối, state một lần, quản lý refresh intent PostgreSQL đa tiến trình, bảo vệ grant active của JIRA-03. Runtime `MYJIRA_ENABLED=off` mặc định; không đổi catalog.
- **Bằng chứng test thật:** PostgreSQL chuyên dụng `ati_jira04` trên loopback, `RUNTIME_MODE=sandbox`; migration 13/13, client 39/39, repo 15/15, token manager 14/14, routes 24/24, wiring 17/17, integration 10/10, JIRA-03 regression 47/47. TDD: URL/cloud ID âm tính đỏ 4/39 rồi xanh 39/39; cookie disconnect đỏ 1/24 rồi xanh 24/24. `npm run typecheck:v3` exit 0. `npm run check` exit 0: schemas 341, adapters 468, planner 381, executor 42, API 1422, web 960, evaluation 406; build/security/launcher/node suites xanh.
- **Review:** Antigravity Gemini 3.8 Flash High review từng phần; review tổng thể SPEC PASS. Các góp ý đã sửa và full check chạy lại. PR CI và reviewer độc lập là bước còn lại trước merge.
- **Bàn giao:** Sau merge, reviewer cập nhật `CURRENT-STATE.md` và `ROADMAP.md`. Task kế tiếp JIRA-05 kiểm tra quyền native Atlassian; chưa triển khai trong nhánh này.