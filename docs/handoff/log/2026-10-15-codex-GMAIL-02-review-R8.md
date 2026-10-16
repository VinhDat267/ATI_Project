# 15/10/2026 · GMAIL-02 · Bổ sung test chống đánh dấu sai lệnh ghi đã gửi

- Task: [GMAIL-02](../tasks/GMAIL-02-gmail-tools.md), PR [#143](https://github.com/VinhDat267/ATI_Project/pull/143).
- Sửa P2 trong [review tại `78e6421`](https://github.com/VinhDat267/ATI_Project/pull/143#issuecomment-6183517969). Base của lượt sửa: `78e642112064574366d941f1a8d26ee2e82dd3c1`.
- Mã sản phẩm hiện tại đúng. Lượt này chỉ bổ sung test và tài liệu, không sửa adapter hoặc executor.

## Thay đổi

Trong `packages/tool-adapters/tests/gmail-adapter.test.ts`:

- Bốn ca lệnh ghi đã tới máy chủ (treo, ngắt kết nối, JSON hỏng, lỗi máy chủ) kiểm thêm rằng lỗi không có `details.requestSent === false`.
- Thêm bốn ca chạy `StepRunner` thật → adapter Gmail thật → máy chủ Google HTTP giả. Kết quả phải là `unknown`, không có dấu chưa gửi và máy chủ nhận đúng một request ghi. Ca treo dùng timeout của executor và `AbortSignal` thật.

## RED → GREEN

Đột biến R8 đổi duy nhất `if (write) writeDispatched = true` thành `false` ngay trước `fetch` ghi.

| Lượt | Lệnh | Kết quả |
|---|---|---|
| Test cũ + R8 | `node .codex/gmail-02-r8-20261015/mutate-r8.mjs baseline` | Vitest exit 0, **64/64**; tái hiện R8 lọt test |
| Test bổ sung + R8 | `node .codex/gmail-02-r8-20261015/mutate-r8.mjs guarded` | Vitest exit 1, **8 fail / 60 pass**; 4 lỗi dấu chưa gửi, 4 lỗi executor trả `failed` thay vì `unknown` |
| Khôi phục mã đúng | `node node_modules/vitest/vitest.mjs run packages/tool-adapters/tests/gmail-adapter.test.ts packages/executor/tests/gmail-pre-dispatch.test.ts` | exit 0, **74/74** |

Script đột biến khôi phục nguồn trong `finally`; hai lượt cùng xác nhận SHA256 `4b1b8028509f9302cd2f71547fee21eb1ce1aa59e6ae86c313bc9c725eb84e3f`. Exit của script là kết quả kiểm đúng kỳ vọng; exit của Vitest được ghi riêng trong bảng và JSON bằng chứng.

## Kiểm toàn bộ tại máy

Worktree thi công riêng, không `.env`, PostgreSQL 16 tmpfs mới ở `127.0.0.1:56733`, API 3303/web 5477, sandbox, hai cờ Gmail/Read Answers tắt. Đã chạy migration và cấp tài khoản admin thử nghiệm, exit 0.

- `npm run check` lượt đầu exit 1: **1 fail / 1.925 pass** ở v3. Ca GMAIL-01 `orders disable after the save, never between its check and insert` dùng mốc trả về của promise (`performance.now`): `expected 4978.609 to be greater than 4978.919`, lệch 0,310 ms. Cùng loại lỗi thời gian reviewer đã ghi; không sửa test hoặc mã GMAIL-01. Giữ nguyên `check-first-failed.log`; eval/build và các gate sau chưa chạy trong lượt này.
- `npm run check` chạy lại tuần tự exit 0: **1.926 v3** = 63 schema + 408 adapter + 272 planner + 42 executor + 462 API + 679 web; **173 eval**. Typecheck, build, quét bản build, launcher 1/1, env/OIDC 10/10 đều đạt. Output: `check.log`.
- Sau check, `npm run test:browser:v3` chạy tuần tự exit 0: **101 pass / 1 skip có chủ đích**, đủ 11 nhóm. Không đổi assertion hoặc timeout browser. Output: `browser.log`.
- Commit và CI sau push được đối chiếu trong PR #143; không dùng CI của `78e6421` để kết luận cho head mới. Không tự merge.

## Rà soát phần sửa

Một reviewer subagent đọc diff test, adapter, executor, máy chủ giả và output RED/GREEN: không có finding trong phần P2. Reviewer xác nhận bộ đếm tăng sau khi nhận POST, timeout dùng `AbortSignal` thật và SHA256 đã khôi phục. Reviewer chỉ đọc, không tự chạy test/check/browser; đây không phải lượt tái chạy độc lập toàn bộ PR. Reviewer của #143 cần xem lại phần thay đổi sau khi push.

## Phạm vi và bằng chứng

- Bằng chứng riêng: `.codex/gmail-02-r8-20261015/` (ignore), gồm script, output RED/GREEN và SHA256.
- Ba P3 giữ nguyên phạm vi review: reviewer sửa mục 3.8 của đặc tả ở PR bàn giao; chuẩn hoá output còn lại và 401 không phải JSON chưa sửa trong lượt này.
- Test thứ tự commit GMAIL-01 dùng đồng hồ JavaScript thuộc việc riêng theo review; không sửa ở PR này.
- Không gọi Google/model thật, không gửi thư thật, không sửa CURRENT-STATE/ROADMAP hoặc file người dùng ở checkout chính.
