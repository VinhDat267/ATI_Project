# Audit độc lập bộ tài liệu ATI Project

> **Lịch sử trước sửa:** báo cáo này giữ kết quả ngày 12/09; các dẫn dòng source mô tả bản gốc trong [archive](archive/pre-fix-2026-09-13.zip). Xem [báo cáo sửa 13/09](FIX-REPORT-2026-09-13.md) để biết trạng thái hiện hành.

Ngày kiểm tra: 12/09/2026. Thư mục: `D:\Môn học\ATI\ATI_Project`.

**Kết luận: chưa nên đóng băng thiết kế hoặc triển khai nguyên kế hoạch hiện tại.** Có nền tảng hữu ích, nhưng ngoài vấn đề thời gian còn có mâu thuẫn về năng lực DSL, duyệt hành động, idempotency, vòng đời dữ liệu và đánh giá. Kết luận trong audit cũ rằng “điểm yếu duy nhất còn lại là phạm vi” không được bằng chứng hiện tại hỗ trợ.

Đây là báo cáo audit, không thay thế đề cương và không chốt cấu hình A/B. Các đề xuất sửa dưới đây chưa được áp vào tài liệu hoặc mã nguồn gốc.

## 1. Phạm vi và bằng chứng

Đã kiểm kê 40 file gốc; đọc tài liệu thiết kế, yêu cầu, hai lộ trình, các audit cũ, API/OpenAPI, SQL, wireframe, prompt, toàn bộ mã DSL và bộ testdata. Wireframe được kiểm tra về luồng và nội dung trong HTML, không phải kiểm thử giao diện đang chạy.

Đã chạy mã DSL trên bản sao tạm, đối chiếu byte của các file package với bản gốc. Môi trường: Node 24.19.0, npm 11.17.0; cài dependency theo manifest hiện có, không sửa source. Các phép thử dùng dữ liệu tổng hợp, không gọi LLM, MCP hay dịch vụ gửi tin nhắn. Không chạy migration PostgreSQL hay engine end-to-end: ba ứng dụng trong `apps/` hiện chỉ có README giữ chỗ.

| Kiểm tra mới | Kết quả |
|---|---|
| Build riêng `@wap/dsl` | Exit 0 |
| `npm run typecheck` ở gốc | Exit 1, TS5083: thiếu `tsconfig.json` gốc |
| `npm run test` | Exit 1: không có file test |
| Sinh JSON Schema | Exit 0 nhưng cả hai definition đều là `{}` |
| 3 enum DB ↔ Zod; run/step ↔ OpenAPI | Khớp các giá trị đã kiểm tra |
| 13 tên event Zod ↔ OpenAPI | Khớp tên; không chứng minh payload khớp |
| OpenAPI | 15 schema, 20 operation HTTP, không có `$ref` nội bộ hỏng |
| SQL | 14 bảng; chưa thực thi DDL trên PostgreSQL |
| FR | 78 FR: 51 Must, 20 Should, 7 Could |
| Danh sách MVP mục 14 | Liệt kê 50 FR, không phải 45 |
| Tool và test case | 27 tool, 30 case; mọi `expected_tools` đều có trong catalog |
| Khả năng dùng bộ case với phạm vi hai server | 10 case vẫn cần GitHub |
| Expected plan trong testdata | 0/30 case có `expected_plan` |

Chi tiết chạy, fixture, version dependency và hash nguồn nằm trong [thư mục bằng chứng](<D:/Môn học/ATI/ATI_Project/docs/audit-evidence/2026-09-12/README.md>).

**Mức độ:** P1 cần xử lý trước khi đóng băng hợp đồng hoặc dùng nó xây luồng chính; P2 cần xử lý trước nghiệm thu/báo cáo. Với phần engine chưa có, phát hiện được ghi là lỗi thiết kế hoặc thiếu hợp đồng, không phải lỗ hổng runtime đã khai thác.

## 2. Phát hiện cần xử lý

### F01 · P1 · Kế hoạch thi hành tự mâu thuẫn và chưa có phạm vi A/B hoàn chỉnh

**Bằng chứng:** [kế hoạch, phần cắt](<D:/Môn học/ATI/ATI_Project/docs/KE-HOACH-6-TUAN.md:37>) cắt hybrid và GitHub; [tuần 5](<D:/Môn học/ATI/ATI_Project/docs/KE-HOACH-6-TUAN.md:128>) lại giao hybrid search và kết nối GitHub lẫn filesystem. Phần “tuyệt đối không cắt” giữ resume, query expansion, replan và ba màn hình, trong khi [QĐ-05](<D:/Môn học/ATI/ATI_Project/docs/QUYET-DINH.md:83>) yêu cầu chọn giữa các tập tính năng khác nhau và gộp màn hình. Lịch cho người B vẫn giao riêng màn hình duyệt ở tuần 4.

[MVP](<D:/Môn học/ATI/ATI_Project/docs/functional-requirements.md:315>) có tổng thực tế 50 FR, nên bỏ riêng FR-EXE-10 sẽ còn 49, không phải 44. Bản yêu cầu có 51 Must. Số lượng FR không thể dùng thay cho ước lượng giờ, nhưng sai số đếm làm sai ma trận nghiệm thu.

Quỹ 135 giờ là số được ghi trong kế hoạch. 230 giờ và 145 giờ của audit cũ (docs/AUDIT.md trước sửa, dòng 36 — bản gốc lưu trong [archive](archive/pre-fix-2026-09-13.zip)) là ước lượng tác giả, chưa có bảng việc nhỏ và số đo năng suất để kiểm chứng. Ngay 145 giờ vẫn vượt 135; “nằm trong sai số” không tạo ra thời gian dự phòng. Phân công 50/50 chưa giải quyết được việc planner, retrieval, engine, API đều dồn nhiều vào người A.

**Cần sửa:** chọn một baseline, cập nhật cùng lúc lịch tuần, FR/NFR, API, wireframe, demo và case được nghiệm thu. Ước lượng theo từng người và chừa thời gian ghép nối. Nếu chọn polling 2 giây phải sửa mục tiêu UI ≤1 giây; nếu bỏ resume phải sửa NFR và chaos test tương ứng. Có thể bắt đầu spike để giảm rủi ro, nhưng chưa nên tuyên bố hợp đồng đã đóng băng.

### F02 · P1 · Năng lực DSL chưa thực hiện được nhiều case chủ lực

**Bằng chứng:** [m02](<D:/Môn học/ATI/ATI_Project/testdata/test-cases.json:109>) cần chọn thành viên ít task nhất sau khi đọc dữ liệu; [m04](<D:/Môn học/ATI/ATI_Project/testdata/test-cases.json:135>) cần bình luận vào từng task; m07/m09/m11/c05/c07 cũng cần lặp, chuyển đổi hoặc tổng hợp dữ liệu. [DSL hiện tại](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/schema.ts:145>) chỉ có bước gọi tool; resolver chỉ đọc đường dẫn và nội suy chuỗi. [Lộ trình sau đồ án](<D:/Môn học/ATI/ATI_Project/docs/LO-TRINH-DAY-DU.md:190>) tự xác nhận `for_each` chưa được hỗ trợ.

Với m02, lấy phần tử đầu tiên không chứng minh chọn được người ít việc nhất; output không có cam kết đã sắp xếp. Với m04, một `add_comment(card_id: string)` không thể bình luận vào tập task có số lượng chưa biết trước. Replan khi có lỗi cũng không tự sửa được một kế hoạch thực thi thành công nhưng chỉ xử lý task đầu tiên.

[m01 và wireframe](<D:/Môn học/ATI/ATI_Project/docs/wireframes.html:88>) truyền `cards` thẳng sang `rows`, nhưng [append_sheet_rows](<D:/Môn học/ATI/ATI_Project/testdata/tools.json:160>) yêu cầu `string[][]`; catalog không định nghĩa output của `list_cards`. Phép thử nội suy danh sách object cho kết quả `Report: [object Object],[object Object]`, không phải báo cáo.

**Cần sửa:** chọn rõ tập thao tác dữ liệu được hỗ trợ, hoặc thu hẹp case thành các workflow DSL hiện tại biểu diễn được. Không tự thêm loops, LLM transform hay nhiều tool mới chỉ để giữ bộ case cũ. Trước tiên viết tay một kế hoạch đúng, fixture đầu vào/đầu ra và kết quả mong đợi cho từng demo chủ lực. Thử m02 với thứ tự thành viên đảo ngược và m04 với 0, 1, 3 task.

### F03 · P1 · Quyền chạy trong dry-run đang phụ thuộc vào nhãn do LLM tự đặt

**Bằng chứng:** [mô tả side_effect](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:225>) cho LLM khai báo read/write rồi engine dùng nhãn này để quyết định chạy thật trong dry-run. [System prompt](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/prompts.ts:90>) chỉ khuyên “khi phân vân chọn write”. Catalog và bảng `tools` chưa có chính sách side-effect do hệ thống quản lý.

**Đã tái hiện ở validator hiện có:** kế hoạch gọi `task_hub.send_slack_message` nhưng khai báo `side_effect: read`, không có idempotency key, được cả Zod lẫn graph chấp nhận. Không có tool nào được gọi trong thử nghiệm. Validator tầng 2 chưa tồn tại; nếu chỉ kiểm tên tool và kiểu args như tài liệu thì trường hợp này vẫn hợp lệ ở tầng đó.

**Hệ quả thiết kế:** một tool ghi có thật có thể bị thực thi trước duyệt nếu engine làm đúng hướng dẫn hiện tại. Việc tool có trong Registry không chứng minh hành động đã được cho phép.

**Cần sửa:** side-effect dùng cho thực thi phải do policy đáng tin cậy quyết định, mặc định chặn thực thi trong dry-run khi chưa phân loại. Chặn mọi bất đồng giữa plan và policy. MCP annotations cũng chỉ là hint cần đánh giá độ tin cậy, theo [đặc tả MCP](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

### F04 · P1 · Lưu idempotency key sau thành công không đảm bảo chống ghi trùng khi mất phản hồi

**Bằng chứng:** [mô tả engine](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:227>) và [DATABASE](<D:/Môn học/ATI/ATI_Project/db/DATABASE.md:41>) hứa ghi đúng một lần bằng cách kiểm key đã thành công. [DDL](<D:/Môn học/ATI/ATI_Project/db/migrations/0001_init.sql:269>) chỉ có key/result và unique `(user_id, key)`; không có trạng thái yêu cầu đang gửi/kết quả chưa xác định, dấu vân tay tham số hay hợp đồng idempotency với phía dịch vụ.

**Phản ví dụ thiết kế:** dịch vụ đã thêm dòng Sheet → phản hồi bị mất hoặc worker chết → chưa ghi key thành công ở DB → retry/resume gọi lại → thêm dòng thứ hai. Unique constraint của DB cục bộ không bao trùm transaction của dịch vụ ngoài. Hai run đồng thời cùng vượt kiểm tra key cũng cần được xử lý, ngay cả khi từng run chạy tuần tự.

Key mẫu `post_report_${runtime.week_start}` chỉ có user và tuần còn có thể chặn nhầm báo cáo của board/kênh khác. Chưa có quy tắc phát hiện cùng key nhưng khác tool hoặc khác args.

**Cần sửa:** mô tả mức đảm bảo theo từng tool. Với tool hỗ trợ idempotency ở nơi nhận, truyền khóa ổn định và kiểm payload. Với write có kết quả chưa rõ, cần đối soát hoặc dừng để xử lý, không retry mù. Định nghĩa operation identity, khóa cạnh tranh, trạng thái và xử lý key trùng khác payload. Chaos test phải chèn lỗi đúng khoảng sau khi dịch vụ commit nhưng trước khi DB cục bộ ghi nhận. Đây là phản ví dụ thiết kế, chưa phải kết quả chạy engine.

### F05 · P1 · Dry-run và replan chưa giữ được ràng buộc “chỉ chạy đúng hành động đã duyệt”

**Bằng chứng:** [FR-APR-03](<D:/Môn học/ATI/ATI_Project/docs/functional-requirements.md:159>) yêu cầu hiện args đã resolve cho mọi write. Nhưng nếu s3 dùng ID/URL do s2 write tạo ra thì dry-run chưa thể có giá trị đó. Thử resolver với output của write chưa chạy trả `ReferenceError_`.

[Luồng replan](<D:/Môn học/ATI/ATI_Project/docs/API.md:63>) chuyển thẳng từ kế hoạch mới sang `running`; [prompt replan local](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/prompts.ts:247>) cho đổi args/tool. [Phiếu duyệt](<D:/Môn học/ATI/ATI_Project/db/migrations/0001_init.sql:292>) chỉ gắn với run và preview, chưa gắn version/hash; [endpoint approve](<D:/Môn học/ATI/ATI_Project/docs/openapi.yaml:333>) không nhận định danh bản người dùng đã xem.

**Tình huống:** người dùng duyệt gửi vào kênh A; replan đổi args thành kênh B; kế hoạch vẫn hợp schema rồi tiếp tục chạy theo sơ đồ hiện tại. Tài liệu chưa có rule bắt buộc duyệt lại. Cũng chưa chốt liệu read từ dry-run được dùng lại hay đọc mới sau duyệt; đọc mới có thể làm thay đổi danh sách người nhận/nội dung đã xem.

**Cần sửa:** gắn approval với bản plan và dữ liệu thực thi đã duyệt; thay đổi write cần được kiểm policy và duyệt lại. Chốt snapshot/freshness của read. Với phụ thuộc write→write, hoặc cấm trong MVP, hoặc có preview thể hiện phần chưa xác định và cơ chế duyệt theo giai đoạn. Không trình bày dữ liệu mô phỏng như kết quả thật.

### F06 · P1 · Run bất đồng bộ chưa tạo được theo đúng hợp đồng DB

**Bằng chứng:** [POST /runs](<D:/Môn học/ATI/ATI_Project/docs/openapi.yaml:245>) trả run ID trước khi planner/validator hoàn thành. [runs.workflow_version_id](<D:/Môn học/ATI/ATI_Project/db/migrations/0001_init.sql:174>) là `NOT NULL`, trong khi [workflow_versions.plan](<D:/Môn học/ATI/ATI_Project/db/migrations/0001_init.sql:150>) được quy định phải là plan đã qua cả ba tầng validate. `planning_attempts` lại bắt buộc FK đến run.

Vì vậy chưa có cách tạo run đang planning mà đồng thời giữ nguyên các ràng buộc đã mô tả. Tạo version giả với `{}` chỉ chuyển mâu thuẫn sang invariant “version đã validate và bất biến”. Lỗi xảy ra ngay từ request đầu tiên, trước khi xét resume.

**Cần sửa:** mô hình hóa rõ run/request trước khi có plan và thời điểm gắn version hợp lệ; quy định failed planning/no-plan. Thêm sơ đồ chuyển trạng thái thống nhất vì [sơ đồ thiết kế](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:367>) dùng `PENDING` không có trong enum. Nghiệm thu bằng request mới và trường hợp planner thất bại, không chèn placeholder trái hợp đồng.

### F07 · P1 · JSON Schema đưa cho LLM đang rỗng

**Bằng chứng:** [package manifest](<D:/Môn học/ATI/ATI_Project/packages/dsl/package.json:14>) dùng Zod 4 và `zod-to-json-schema` 3; [script sinh schema](<D:/Môn học/ATI/ATI_Project/packages/dsl/scripts/emit-json-schema.ts:5>) truyền trực tiếp schema Zod 4 vào converter.

**Đã tái hiện:** `npm run schema:json -w @wap/dsl` exit 0 nhưng sinh `definitions.WorkflowPlan = {}` và `definitions.LlmPlanDraft = {}`. Dependency resolve trong lần kiểm tra: Zod 4.6.2, converter 3.25.2. Build thành công không phát hiện được lỗi này vì script ở ngoài `tsconfig` chỉ include `src/**/*` và được chạy bằng tsx.

**Hệ quả:** schema xuất ra không mang các ràng buộc DSL để ép structured output. Zod runtime vẫn còn khả năng validate; không được suy ra toàn bộ hệ thống đã mất validation.

**Cần sửa:** dùng converter phù hợp phiên bản và kiểm schema thực sự có properties/required/steps trước khi tích hợp LLM. [Converter ghi rõ không hỗ trợ schema v4](https://github.com/StefanTerdell/zod-to-json-schema); [Zod 4 có xuất JSON Schema trực tiếp](https://zod.dev/json-schema). Sau sửa vẫn cần kiểm giới hạn JSON Schema mà nhà cung cấp LLM hỗ trợ.

### F08 · P1 · Nhánh từ chối được prompt yêu cầu nhưng schema cấm

**Bằng chứng:** [prompt](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/prompts.ts:125>) yêu cầu `steps: []` và tên `KHÔNG THỂ:` khi không làm được. Hai case s10/c08 đòi hành vi này. Nhưng [WorkflowPlanSchema](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/schema.ts:215>) và [LlmPlanDraftSchema](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/schema.ts:324>) đều `.min(1)`.

**Đã tái hiện:** câu trả lời từ chối đúng prompt bị cả hai schema bác với lỗi `too_small` tại `steps`. Sau khi sửa JSON Schema ở F07, schema chặt sẽ càng làm mâu thuẫn này rõ hơn.

**Cần sửa:** dùng kết quả planner có nhánh plan/refusal/clarification rõ ràng, ánh xạ sang trạng thái và API; chỉ plan thực thi mới cần ít nhất một step. Kiểm đúng hành vi từ chối mà không tiêu hết ba vòng sửa hoặc ép AI bịa bước.

### F09 · P2 · Validation tham chiếu còn bỏ lọt lỗi và không luôn trả lỗi có cấu trúc

**Bằng chứng:** [validateGraph](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/graph.ts:157>) thu refs từ args/condition nhưng không kiểm `idempotency_key`. Lời gọi `collectReferences(step.tool.args)` nằm ngoài khối bắt exception. [extractReferences](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/reference.ts:95>) chỉ nhận mẫu regex hợp lệ, nên đoạn `${...}` viết sai có thể bị coi như literal.

**Đã tái hiện:** key tham chiếu `steps.missing` vẫn có `ok: true`; `${unknown.id}` trong args ném exception thay vì trả `GraphValidationResult`; `${steps.s1.output.cards[0].title}` được graph chấp nhận và resolver giữ nguyên chuỗi sai. API chưa triển khai nên chưa kết luận các lỗi này sẽ trở thành HTTP 500.

**Cần sửa:** kiểm tất cả trường có thể chứa reference, phát hiện cú pháp reference chưa hợp lệ, trả issue có path thống nhất. Tách cảnh báo “read có thể thừa” khỏi lỗi chặn kế hoạch. Validator tầng 2 cũng phải phân biệt literal với reference chưa có giá trị, rồi validate lại args thực tế trước `tools/call`; hiện tầng 2 chưa có mã dù [kế hoạch](<D:/Môn học/ATI/ATI_Project/docs/KE-HOACH-6-TUAN.md:56>) nói đã có sẵn validate ba tầng.

### F10 · P2 · Bộ đánh giá chưa đo được mức hoàn thành đúng yêu cầu

**Bằng chứng:** 10/30 case dùng GitHub: s04, m03, m05, m06, m08, m12, c02, c03, c04, c06. Sau khi bỏ GitHub chỉ còn 18 case có expected tools không rỗng, cộng 2 case từ chối; trong 18 case còn cả trường hợp mơ hồ hoặc DSL chưa hỗ trợ. Cắt `task_hub` từ 16 xuống 8 còn làm giảm tập khả dụng nữa.

Không case nào có expected plan, fixture dữ liệu hoặc điều kiện kiểm trạng thái cuối. [Chỉ số completion](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:561>) chỉ kiểm run đến `SUCCEEDED`, nên một run gửi sai người hoặc chỉ xử lý task đầu tiên vẫn có thể được tính thành công. Có đủ tên tool không chứng minh có đúng filter, mapping hay side-effect.

[Hướng dẫn tinh chỉnh prompt](<D:/Môn học/ATI/ATI_Project/packages/dsl/PROMPTS.md:68>) dùng cùng 20–30 case để sửa và đo lại, chưa tách tập phát triển/giữ lại để đánh giá cuối. Khi thay đổi quy mô 10/20/50 tool cũng chưa có manifest bảo đảm tool cần thiết vẫn nằm trong catalog. Recall của baseline “đưa toàn bộ tool” vốn bằng 1 với case có nhãn khả dụng, không phải bằng chứng baseline giải tác vụ tốt hơn. Query expansion cần được tính cả token/latency của lời gọi bổ sung.

**Cần sửa:** mỗi case có profile A/B, fixture, expected outcome và side-effect được phép/cấm; chấp nhận các kế hoạch tương đương về ngữ nghĩa. Tách dev/holdout, cố định model/prompt/catalog/data và lặp chạy có thống kê. Báo riêng plan validity, task correctness, refusal accuracy, recovery và chi phí. Với nhãn rỗng, định nghĩa metric riêng. Không điều chỉnh ngưỡng nghiệm thu sau khi xem kết quả cuối mà không công bố thay đổi.

Các số nhỏ khác cũng cần sửa: `task_hub` được dùng trong expected labels là 12 tool, không phải 10 như audit cũ; c07 bắc cầu 2 server, không phải 3. Đây là lỗi thống kê phụ, không phải vấn đề cốt lõi của benchmark.

### F11 · P2 · “Hai MCP Server” che khuất bốn tích hợp và hợp đồng dữ liệu chưa chốt

**Bằng chứng:** [task_hub](<D:/Môn học/ATI/ATI_Project/testdata/tools.json:6>) gộp Trello, Slack, Sheets, Calendar. Chưa có quyết định cụ thể rằng backend này gọi dịch vụ thật, dùng DB local hay là mô phỏng. Nếu gọi thật vẫn có bốn bộ credential/quyền, mapping định danh thành viên, giới hạn API và chuẩn bị dữ liệu. Một tên MCP Server không làm các việc đó biến mất.

Catalog là fixture tự viết, chưa có bản `tools/list` chụp từ server công khai đã pin phiên bản. Tầng registry/prompt chỉ giữ input schema; chưa quy định output schema, cách tách `structuredContent`/`content`, và xử lý kết quả `isError: true`. Phân loại lỗi theo 400/404/429/503 chưa đủ cho MCP stdio hoặc lỗi tool trong JSON-RPC response. Những cấu trúc này được quy định trong [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

**Cần sửa:** chọn rõ thật/local/mô phỏng cho từng tích hợp, pin server/version và kiểm discovery/call bằng một ví dụ thật. Chốt normalized tool result và error mapping, output fixture cho các tool demo. Thu hẹp tuyên bố “bất kỳ MCP Server nào cũng dùng được ngay” theo transport, schema và policy đã hỗ trợ. Không lấy fixture tự viết làm bằng chứng tương thích live.

### F12 · P2 · Audit cũ và README mô tả mức sẵn sàng cao hơn trạng thái kiểm chứng được

**Bằng chứng:** audit cũ (docs/AUDIT.md trước sửa, dòng 112 — bản gốc lưu trong [archive](archive/pre-fix-2026-09-13.zip)) kết luận kỹ thuật nhất quán và phần mã qua test. Hiện build DSL pass nhưng lệnh test không có test, typecheck gốc lỗi và generator xuất schema rỗng. Có thể tác giả từng chạy kiểm tra tạm ngoài thư mục; không có artifact đó để tái lập nên không kết luận họ chưa từng chạy.

[README](<D:/Môn học/ATI/ATI_Project/README.md:13>) đưa một luồng “chạy lần đầu” đến dev server, nhưng apps chỉ có README và thiếu `scripts/migrate.mjs`, `scripts/seed.mjs`. Thiếu ứng dụng ở giai đoạn plan không phải lỗi tự thân; trình bày luồng dự kiến như khả năng hiện có mới gây hiểu nhầm. [Lệnh sinh API types](<D:/Môn học/ATI/ATI_Project/docs/API.md:109>) và CONTRIBUTING trỏ `api/openapi.yaml` trong khi file thật ở `docs/openapi.yaml`.

**Cần sửa:** ghi rõ “đã có / skeleton / kế hoạch”, giữ command kiểm chứng cùng fixture và log. Thay kết luận audit dựa trên enum/count bằng kiểm hành vi quan trọng. Hợp nhất đường dẫn tài liệu chuẩn hoặc biến bản sao gốc thành chỉ dẫn đến bản chuẩn; hai file AUDIT gốc/docs đã khác hash.

### F13 · P2 · Luận điểm khác biệt và tính tái lập đang bị khẳng định quá mức

**Bằng chứng:** [bảng đối thủ](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:13>) nói Zapier/n8n tạo workflow thủ công và phải chờ nền tảng hỗ trợ tool mới. Nguồn chính thức hiện có [Zapier Copilot tạo/chỉnh workflow từ mô tả](https://help.zapier.com/hc/en-us/articles/15703650952077-Use-the-power-of-AI-to-generate-Zaps) và [n8n MCP Client Tool gọi tool server ngoài](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/). Vì vậy bảng phân biệt hiện tại không đứng vững. Việc chọn người ít task nhất cũng có thể là phép chọn min, không tự chứng minh cần suy luận AI.

[Plan-then-execute](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:80>) hứa cùng plan chạy lại cho kết quả giống hệt. Điều này chỉ đúng khi các yếu tố liên quan được cố định hoặc phát lại: runtime dates, inputs, dữ liệu ngoài, tool version, phản hồi và side-effect. Quy tắc engine xác định không biến API ngoài thành dữ liệu bất biến.

Thiếu tình huống người dùng thật, mẫu công việc, thời gian làm tay, lỗi thường gặp và điều kiện thành công. Hai workbook trong `Final Project` được kiểm tra có sheet về nhóm/đăng ký, không tìm được nội dung rubric liên quan bằng phép tìm đã lưu. Chưa xác minh độc lập trọng số chấm điểm hoặc yêu cầu bắt buộc tự viết engine; đây là giới hạn nguồn, không kết luận rubric trong tài liệu là sai.

**Cần sửa:** định vị thành prototype nghiên cứu việc lập kế hoạch MCP có kiểm soát, với đóng góp đo được ở retrieval, validation/approval hoặc recovery. So sánh hành vi và số liệu trên cùng tác vụ; nêu giới hạn công khai. Giữ một người dùng, một công việc và nguồn rubric chính thức để quyết định ưu tiên. Không cần tự nhận mới hơn n8n để có giá trị đồ án.

### F14 · P2 · API/event contract còn quá lỏng để bảo đảm frontend và backend khớp

**Bằng chứng:** [RunDetail.plan](<D:/Môn học/ATI/ATI_Project/docs/openapi.yaml:606>) là object bất kỳ, [RunEvent.payload](<D:/Môn học/ATI/ATI_Project/docs/openapi.yaml:724>) cũng vậy. Chỉ khớp 13 tên event không phải khớp hợp đồng payload. [PlanReadyEvent](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/events.ts:82>) nhận `z.unknown()` cho plan; thử `plan: 42` vẫn pass. `run.finished` còn chấp nhận status `running`.

[dryrun.ready](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/events.ts:114>) chỉ có approval_id, expiry và số bước, không có preview, trong khi [API.md](<D:/Môn học/ATI/ATI_Project/docs/API.md:94>) nói event luôn đủ cập nhật UI không cần API thêm. Wireframe có nút chủ động dry-run, nhưng POST /runs tự dry-run và chưa có trạng thái/endpoint trung gian phù hợp.

OpenAPI khai báo 3.1 nhưng nhiều field nullable vẫn dùng cú pháp 3.0 `nullable: true`; cần thống nhất theo dialect của [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0.html) và kiểm bằng công cụ sinh type/validator thực sự trước khi đóng băng. Ví dụ DSL trong [bản mô tả](<D:/Môn học/ATI/ATI_Project/docs/mo-ta-du-an.md:164>) có `workflow_id` trong plan; schema `.strict()` hiện bác trường này, đã tái hiện.

**Cần sửa:** định nghĩa union payload theo event, tái sử dụng kiểu plan ở ranh giới đã chọn, chốt UI fetch thêm hay event chứa preview. Viết sequence cho thành công, refusal, hết hạn duyệt, hủy, replan và reconnect. Sửa source-of-truth và ví dụ trước khi sinh mock cho frontend.

## 3. Các điểm bổ sung cần ghi thành quyết định

- **Múi giờ:** [buildRuntime](<D:/Môn học/ATI/ATI_Project/packages/dsl/src/reference.ts:217>) tính ngày/tuần bằng UTC. Fixture 01:00 thứ Hai ở Việt Nam trả `week_start` của tuần trước. Đây là hành vi đã đo; nó là lỗi nghiệp vụ nếu “tuần này” được hiểu theo giờ người dùng. Chốt timezone và ranh giới thời gian trước khi dùng dữ liệu thật, thay vì hứa runtime loại bỏ hoàn toàn lỗi ngày tháng.
- **Prompt boundary:** `neutralize()` chỉ áp lên description. Một marker đóng khối đặt trong `inputSchema.description` vẫn xuất hiện nguyên vẹn trong catalog; phép thử đếm được hai marker đóng. Điều này bác phạm vi khẳng định “không phá được ranh giới” của builder, chưa chứng minh LLM thực sự bị điều khiển. Policy ở F03 vẫn cần độc lập với prompt.
- **BM25:** [SQL index](<D:/Môn học/ATI/ATI_Project/db/migrations/0001_init.sql:129>) GIN/tsvector không tự tạo thuật toán BM25. PostgreSQL 16 mô tả `ts_rank` và `ts_rank_cd` với cách xếp hạng riêng trong [tài liệu text search](https://www.postgresql.org/docs/16/textsearch-controls.html). Nếu hybrid đã cắt, chỉ cần ghi đúng trong hướng phát triển.
- **BullMQ:** không nên viết rằng thư viện hoàn toàn không biết quan hệ phụ thuộc. [BullMQ Flows](https://docs.bullmq.io/guide/flows/) có parent/child dependencies. Vẫn có lý do xây lớp DSL, approval và điều phối riêng, nhưng cần phân biệt phần có sẵn với phần tự làm.
- **Khôi phục và trace:** tài liệu chưa quy định đồng bộ status/event/queue khi crash, cách cấp seq cùng transaction, và bảo toàn version/tool tương ứng từng lần thử sau replan. Việc giữ JSON version bất biến chưa tự chứng minh toàn bộ lịch sử gọi tool được tái dựng chính xác.
- **Allow-list:** cho phép chung `node,npx` chưa mô tả executable/package/version/args nào được tin cậy; với stdio cần chính sách khởi chạy cụ thể. Hiện chưa có ConnectionManager nên đây là yêu cầu thiết kế cần chốt, không phải kết luận có đường khai thác đang chạy.

## 4. Phần nên giữ

Các lựa chọn có ích hiện thấy trong artifact: tách plan với runtime state; DSL dùng chung; validate chu trình và phụ thuộc bắc cầu; condition parser có grammar hẹp; có cổng duyệt, lịch sử version, bảng đo đạc, mốc end-to-end và tuần dành cho báo cáo/demo. Phép thử mới xác nhận graph bác chu trình, condition xử lý mẫu hợp lệ và bác lời gọi hàm ngoài grammar.

Những điểm này đủ làm nền cho một prototype có phạm vi hẹp. Chúng chưa chứng minh engine, độ an toàn, chất lượng AI hay hiệu quả với người dùng đã đạt yêu cầu.

## 5. Thứ tự xử lý đề xuất

1. **Chốt baseline và demo có thể biểu diễn:** chọn A/B cùng mode thật/local của task_hub; viết kế hoạch tay và fixture cho 3–5 luồng đại diện; giải quyết F01/F02/F11 trước khi tính lại lịch.
2. **Chốt các ràng buộc đúng đắn:** side-effect policy, approval gắn version/snapshot, write chưa rõ kết quả, vòng đời run trước khi có plan, planner refusal. Đây là F03–F06/F08, ảnh hưởng trực tiếp hợp đồng phải đóng băng.
3. **Kiểm chứng nền kỹ thuật:** sửa generator, validator, typecheck/test và API/event contract; dùng các phản ví dụ đã lưu để kiểm lại. Chạy một workflow JSON tay qua MCP thử nghiệm trước khi đưa LLM vào.
4. **Chốt đánh giá và báo cáo:** tách dataset đúng scope, thêm oracle kiểm trạng thái cuối và bộ holdout; sửa bảng đối thủ, tuyên bố độ tin cậy và nguồn rubric. Đo sớm từ bản chạy được đầu tiên.

Nghiêng về cấu hình B chỉ hợp lý nếu trọng tâm ATI/AI trong rubric được xác nhận. Dù chọn A hay B, việc bỏ resume hoặc WebSocket không giải quyết các lỗi về dataflow, approval và idempotency. Chưa có cơ sở xác nhận bất kỳ cấu hình nào vừa 135 giờ cho đến khi các hợp đồng trên được làm rõ và ước lượng lại.
