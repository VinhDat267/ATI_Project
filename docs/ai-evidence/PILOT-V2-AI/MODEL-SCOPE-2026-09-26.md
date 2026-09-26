# Phạm vi đo AI và sửa dataset gate — 26/09/2026

**Trạng thái:** `CODE_TESTED / INDEPENDENT_REVIEW_PASSED / NEW_CAMPAIGN_NOT_RUN`.

## Nguyên nhân

`cases.json` và `holdout.json` cũ là bộ nghiệm thu hệ thống, không phải mọi ca đều
đo được bằng một lần gọi model không dispatch. Các ca approval hết hạn, revision
drift, chống trùng và timeout cần trạng thái/transport của hệ thống. Số write thực
thi trong oracle không tương đương số write model đề xuất.

Parser kiểm toàn bộ snapshot trước khi chọn request ID, đúng kế hoạch foundation
đã duyệt. Chỉ hỗ trợ `web_change` và `design_asset`. Không thay parser/policy để
cho `general` chạy. Holdout cũ có các ca `general` mong đợi plan/clarification,
có oracle refusal cho mâu thuẫn vốn cần clarification; một số refusal khác bị
lỗi type che khuất lý do nghiệp vụ. Bộ cũ được giữ nguyên để truy vết, đã được
xem khi chẩn đoán và không còn được gọi là holdout chưa thấy.

## Phạm vi mới: `model-only-v1`

| Nhóm | Biến thể | Đo gì |
|---|---:|---|
| Public V2-01–12 và V2-20 | 26 | Đề xuất quyết định/tool/args; trong đó V2-11/V2-20 có 4 ca tuân thủ source refusal |
| Public V2-13–19 | 14 loại khỏi tỷ lệ AI | Giữ trong bộ nghiệm thu quyền/approval/reservation/recovery; không gọi provider |
| `ai-holdout-v1.json` mới | 20 | 10 tình huống vi/en được agent độc lập soạn, schema/checklist/args được reviewer kiểm |
| `holdout.json` cũ | 20 không dùng | Legacy diagnostic, không tính vào mẫu đo mới |

Tổng mới **46**, gồm **42 model reasoning + 4 source-refusal compliance**.
Không công bố tỷ lệ trên 60 hoặc tính ca bị loại là model FAIL/PASS. Group source
refusal chỉ chứng minh model tuân thủ kết quả parser đã biết; V2-20 không chứng
minh model tự nhận diện yêu cầu email ngoài catalog.

Known `NOT_FOUND`/`REQUEST_TYPE` chỉ đi vào model qua envelope kiểm tra nguồn,
ghi rõ lỗi của **toàn bộ snapshot**, request ID và không có nội dung hàng khác.
Model vẫn được reserve/call/journal một lần. Write đề xuất khi nguồn bị từ chối
bị đánh dấu unsafe. Lỗi header, duplicate, limit/cell khác vẫn fail closed.
Holdout mới không được phép dùng source-rejection để che oracle lỗi.

Freeze khóa profile, prompt, catalog, behavior/scope, dataset mới và provenance.
CLI kiểm toàn bộ dataset phù hợp trước lượt gọi đầu tiên. Report ghi exclusions,
denominator và hai group; không đo execution outcome. Journal giữ diagnostic
429 `too_many_requests` đã allowlist, không lưu provider prose hoặc credential.

## Xác minh

- `npm run check`: typecheck/build/schema đạt; DSL 44, engine 585 passed + 1
  skipped, API 86, web 139. Sau đó regression journal mới đạt 8/8 và build engine
  đạt. Test chứng minh source hợp lệ + hàng khác sai type vẫn bị từ chối toàn
  snapshot, system case không reserve/gọi model, freeze bắt drift dataset và
  provenance, và 429 settle/reopen đúng.
- Reviewer độc lập: 50 tests qua 5 files đạt, không còn blocker; holdout mới đủ
  20 records và cặp vi/en, hợp đồng nguồn/args/hash hợp lệ. Không dùng các oracle
  holdout mới để điều chỉnh prompt.
- Fresh holdout SHA256 trước provider:
  `28ca61d77bdbdb47a22da555c2fe8e181e61cfa2a1d65a38869af2c8714430c9`.

## Giới hạn và bước chạy

Chạy manifest mới từ HEAD sạch theo thứ tự probe → smoke → public → holdout,
model được allowlist/kiểm giá chính xác và attestation Free Tier không billing,
trần 0 USD. Dừng khi lỗi provider, usage thiếu, unsafe hoặc journal không chắc
chắn. Không retry attempt cũ, không đổi account/key để vượt quota.

Chấm tự động mới chỉ kiểm cấu trúc quyết định và args; cần adjudication nội dung
độc lập, kiểm ngưỡng và nghiệm thu người dùng trước `AI_QUALITY_MEASURED`/handoff.
Nếu sửa prompt theo kết quả holdout mới, bộ đó trở thành diagnostic; cần holdout
mới cho lần nghiệm thu cuối.

## Probe sau khi khóa scope

- Commit `5713c84` tạo manifest cục bộ `%TEMP%\pilot-quality-manifest-20260926-095924.json`
  cho `gemini-3.1-flash-lite`, Free Tier/0 USD, hash
  `7bbd7603df9da335b76c49f3e50d36314d345724bc24174db256e38bc16ce9c1`.
  Price check đúng model đạt; trần 46 lời gọi. Một probe V2-01-vi đã reserve
  và dừng với `PROVIDER_RESPONSE_INVALID`. Journal
  `%TEMP%\pilot-quality-journal-20260926-095924\` ghi 1 failed attempt;
  report `%TEMP%\pilot-quality-report-probe-20260926-095924.json` có 1/46
  attempted, 45 unattempted, usage toàn chiến dịch unknown, 0 passed. Không
  retry trong chiến dịch này, không chạy smoke/public/holdout.
- Mã lỗi trước đó gom HTTP envelope, thiếu output text, JSON và wire schema.
  Đã thêm `failureStage` thuộc enum cố định vào diagnostic/journal, không lưu
  response/prose/prompt/credential. Một test còn chứng minh không đổi nhãn
  `MODEL_MISMATCH` hoặc `output_missing` thành `output_json`.
- Lỗi `PROVIDER_RESPONSE_INVALID` của probe trên **chưa được phân loại stage**
  vì code lúc gọi chưa có diagnostic này; không suy đoán là model trả JSON sai.
  Lượt chẩn đoán tiếp theo phải dùng manifest/commit mới, một lần gọi có trần
  và dừng nếu provider không hợp lệ. Không gộp với hai ca pass ở freeze cũ.

## Kết quả sau các lượt chẩn đoán

Tại freeze `80080bc0f86defdb50a19bfc5434b526332481b22a0515760c1ff2f64c028e8b`
ở commit `c9df557`, Gemini 3.1 Flash-Lite hoàn tất 26/26 public calls:
25 structural PASS, V2-10-en FAIL do đề xuất write khi người nhận mơ hồ.
Không có failed provider attempt trong chiến dịch này. Report cục bộ là
`%TEMP%\pilot-quality-report-public-20260926-103439.json`; 20 holdout chưa
được gọi và vẫn niêm phong. Điểm public chỉ thuộc freeze này, không cộng với
các lượt probe/smoke cũ. Chưa adjudicate nội dung độc lập và chưa đối soát
hóa đơn, nên trạng thái vẫn `PARTIAL_NOT_MEASURED`. Xem [nhật ký điều tra](PROBE-2026-09-26.md).

Freeze sau assignment guard (`efce519`) dừng tại V2-03-vi sau 9 public calls:
8 structural PASS, 1 đầu ra plan/DSL không hợp lệ, 37 ca chưa gọi. Holdout vẫn
niêm phong. Report cục bộ `%TEMP%\pilot-quality-report-public-20260926-122306.json`.
