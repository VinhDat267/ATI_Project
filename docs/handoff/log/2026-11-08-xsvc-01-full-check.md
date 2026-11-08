# 2026-11-08 · XSVC-01 — chạy lại một mạch `npm run check`

- **Nhánh:** `docs/xsvc-01-cross-service-audit`
- **SHA đứng khi chạy:** `b05d49a20b68361f3f63b222f9332d744de5b7c6` (`b05d49a2`, gồm `58e8e38e` và `4cbbfb69`)
- **Database kiểm thử:** container `ati-pr277-fix-db`, `DATABASE_URL=postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3` (không chạm database live `55533` hay server live `:3000` / `:5174`).
- **Kết quả chạy một mạch `npm run check`:** **PASS, exit code `0`**

## Số test từng package & bước kiểm tra

- `typecheck:v3`: PASS (`tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit`)
- `@wap/tool-schemas`: `25` test files, `579` passed (`579`)
- `@wap/tool-adapters`: `22` test files, `638` passed (`638`) + `test:probe`: `32` pass, `0` fail
- `@wap/planner`: `39` test files, `555` passed (`555`)
- `@wap/executor`: `7` test files, `56` passed (`56`)
- `@wap/chat-api`: `258` test files, `2554` passed (`2554`)
- `@wap/chat-web`: `114` test files, `1198` passed (`1198`)
- `evaluations` (`npm run test:eval:v3`): `31` test files, `500` passed, `1` skipped (`501`)
- `build:v3` & `node scripts/test-v3-web-build-security.mjs`: PASS
- `test:launcher:v3` (`scripts/start-v3.test.mjs`): `1` pass, `0` fail
- `node --test` (`v3-local-env`, `fake-oidc`, `google-oidc-fixture`, `slack/inventory`, `fake-slack-personal`, `slack/contract-probe`): `66` pass, `0` fail
