# SLACK-03B4 · Approved personal Slack reads in ATI

**Status:** implementation and local integration complete01/11/2026; independent review findings fixed with regressions. Publication/exact-head CI and staging acceptance remain pending at commit.
**Branch:** feat/slack-03b4-public-read, stacked on03B3 commit c63a24f6 (PR221); exact-head CI/integration of221 is required before staging acceptance.
**Spec:** ../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md
**Plan:** ../../superpowers/plans/2026-11-01-slack-m2-read-integration.md
**Owners:** root coordinates planner/schema/backend/frontend interfaces in this isolated worktree; no concurrent implementer. Independent reviewer at the branch gate.

## Deliverable
A signed-in member selects an owned Slack workspace, asks for a bounded core read, previews a server-bound plan, approves, and receives guarded results in ATI. No Slack call before approval. Same app planner/execution/HTTP/browser entrypoints, PostgreSQL and actual HTTP fixture.

## Scope and interfaces
- New planner planSlackRead(provider,{request,slackUserId,signal?,timeoutMs?}): Promise<PlannerResponse>. Metadata-only, no gather/history/working-memory source; strict eight-read catalog, no model/client binding; ordinary workflow write rule unchanged.
- Literal resource IDs must come from the request or the selected caller identity. Ambiguous named resources lead to clarification/listing, not guessed index selection.
- New internal SlackReadProposalService.propose({userId,connectionId,request,signal?}) returns {response,labels}; verifies ownership/current planning/manual/storage policy before provider; server binds exact connection after validating proposal.
- POST /api/conversations/:id/slack-read-plans {content,connectionId,tempId?}, authenticated/owned and absent when unavailable. It creates an ordinary correlated user turn and an approval plan through createSlackReadPlan.
- Server bootstrap wires existing03B3 runtime and private wrapper with native-pinned/explicit-loopback endpoints. No shared/sandbox fallback for myslack.
- Cockpit opt-in read mode with workspace label+ID+actor; one owned workspace per request, explicit choice when multiple. Preview states read purpose and <=1day result retention. This durable path requires explicit storage permission; no-consent/retention0 never silently persists.
- Results show useful channel/message/user data and source workspace, not internal policy/provenance JSON.
- Source reload notices clear cached sensitive data before owner-checked guarded HTTP refresh; visible read results revalidate on focus/interval. Logout/owner switch/stale replies cannot restore data.
- Defaults remain off. No native/model acceptance, writes,03D/03E,04C,05/06,07 or main release.

## Required evidence
- [x] RED/GREEN planner isolation, wrong/write/unknown tool, fabricated binding/ID, ambiguity and real AbortSignal.
- [x] PostgreSQL/HTTP public request→preview→approval→result, no read before approval; cross-owner and flags-off.
- [x] Guarded result reload/revocation and physical erasure use03B3 lineage, including empty and member collections.
- [x] UI workspace selection/owner-switch, read preview/results and cleared stale data.
- [x] Actual server bootstrap fixture browser at375/1440 light/dark; no native claims.
- [ ] Fullcheck, relevant/full browser CI, independent review and exact-head CI before staging acceptance.

## Kết quả
Đã nối planner→HTTP→preview→approval→private runtime→guarded result và giao diện chọn workspace. Model chỉ nhận yêu cầu người dùng và metadata; không có Slack transport trước duyệt. Chấp thuận lưu1ngày bắt buộc cho luồng có lịch sử này. Public planner chưa dùng dependency từ kết quả Slack; người dùng liệt kê rồi chọn mã cho lượt kế tiếp.

Review độc lập tìm ba lỗi frontend, đã tái hiện và sửa trong một pass: stale route/history response khôi phục cache, polling chồng nhau khi tải chậm, raw output trong receipt. Hồi quy cuối24/24, exit0. Reviewer chỉ đọc source; không suy native hoặc chứng nhận mọi yêu cầu backend từ review đó.

`npm run check` cuối: **exit0**,3327v3+406eval+1launcher+66Node=**3800**, typecheck/build/security đạt. `SCENARIO=slack_read npm run test:browser:v3`: **4/4**, exit0,375/1440 sáng/tối, gồm signed deletion và DOM cleared. Fullcheck SHA256:`8BC02A14844B3066FFD0766EE4B8F212AC975D851E26CC20A705573A141CF0FE`.

PR221 dependency đã merge staging`3d90e862`, exact-head CI xanh, merge tree bằng publishedc63a. Publication/CI của03B4 cần được reviewer ghi sau merge; chưa bật cờ/main/live. Xem [log](../log/2026-11-01-slack-03b4-public-read.md) cho failed attempt, phạm vi và quyết định.
