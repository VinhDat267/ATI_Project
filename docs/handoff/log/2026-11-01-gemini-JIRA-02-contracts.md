# 01/11/2026 — JIRA-02: contracts Jira OAuth và workspace

**Nhánh:** codex/jira-02-contracts. **Base:** b29ab2e. **Source:** 6c53436626149b304195446c2add51bbc1e92651.
**Task:** [JIRA-02-contracts](../tasks/JIRA-02-contracts.md). **Plan:** [chi tiết](../../superpowers/plans/2026-11-01-jira-02-contracts.md).

## Kết quả

- Thêm 5 tool myjira, registry personal opt-in, actor/account/workspace/grant binding, plan/source validators, JSON tuple provenance và pure policy có currentBinding hiện tại độc lập với nguồn lịch sử.
- Hoàn thiện API DTO workspace/member/site/project/invite, lỗi native403/auth/UNKNOWN-write tách biệt, protocol-only secret boundaries và compiler fixture được chạy trong package test/CI. Catalog mặc định giữ 33 tools/8 services.
- Chỉ sửa tool-schemas và ba tài liệu của card. Không sửa CURRENT-STATE, ROADMAP hay thay đổi .gitignore có sẵn của checkout gốc; không triển khai runtime hoặc bật cờ.

## Bằng chứng

| Kiểm tra | Output thực tế |
|---|---|
| Trước source | 5 suite missing-module, exit 1, 0 assertions; missing-export tsc exit 2 |
| RED hành vi sau review | 27 fail / 197 pass (224), exit 1; DTO compiler exit 2 |
| npm test -w @wap/tool-schemas | tsc fixture + 17 files, 341/341 PASS, exit 0 |
| Contracts tsc riêng và typecheck:v3 | Cả hai exit 0 |
| npm run check | exit 0: sáu workspace PASS, eval 406/406 PASS, build/security/launcher/Node PASS |
| Guard mutations | 9/9 killed bằng assertion; phục hồi byte gốc và kiểm SHA từng lần |
| Code review | Backend ĐẠT; AI whole-branch ĐẠT; Frontend ĐẠT trên 6c53436; không còn Critical/Important |

Codex Reality Checker chạy lệnh độc lập; ba reviewer đọc diff thực tế và đối chiếu spec. Không tính RED do fixture dựng sai là bằng chứng guard. Full check dùng PostgreSQL tạm riêng (56533), không dùng database ATI runtime hoặc .env của checkout gốc.

Integration và các reviewer dùng Gemini 3.8 Flash High, effort high. Sau khi 9Router hết quota, tiếp tục bằng Antigravity CLI native cùng model; không đổi sang model khác. Không đưa token, callback code/state thật hay dữ liệu Jira thật vào repo.

## Quyết định kỹ thuật và bàn giao

- Policy phải so currentBinding đủ bảy trường với nguồn lịch sử, kể cả membership và identity generation. Metadata/version không thay kiểm native.
- Bounded authorization lease qua native-check/send/settlement và revoke dùng cùng sorted lock order được đặc tả cho Backend; token refresh tách khóa và lấy token trước authorization. JIRA-02 không triển khai SQL lease.
- Site output có id alias và observedFields giữ site metadata; source dùng numeric stable IDs. JSON tuple codec vẫn là bốn chuỗi, chống separator collision. Grounding/dedup nhiều site thật thuộc JIRA-07.
- API link site chỉ nhận cloudId; Backend lấy name/url từ provider, kiểm grant/ADMINISTER, CAS và project selector không wildcard. Types không thay thế runtime validation/serializer.
- PR phải có CI xanh đúng final head trước merge. Xem checks của PR cho trạng thái CI cuối; người review cập nhật CURRENT-STATE/ROADMAP bằng PR docs sau merge.
- Sau merge mới mở JIRA-03, JIRA-06, JIRA-09A. JIRA-03/04/05/08 tuần tự vì cùng Backend module. Runtime/HTTP/PG/AbortSignal, model campaign và multi-site live acceptance chưa được nghiệm thu; không đóng toàn bộ Jira OAuth từ card này.
