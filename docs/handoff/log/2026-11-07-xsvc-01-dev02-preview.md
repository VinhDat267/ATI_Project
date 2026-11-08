# 2026-11-07 · XSVC-01 — xem trước báo cáo PR rồi Slack

Prompt yêu cầu đọc Pull Request đang mở của `VinhDat267/ati-test` và soạn tin vào kênh ati-test. `LIVE_APP_CANCEL=1` bấm Hủy.

Plan `rejected`, 0 execution step. Bước một là `github.list_pull_requests`. Bước hai là `slack.send_message`. `reportEvidence` gắn vào nội dung tin: `github_prs`, `itemCount` 0, `coverage` complete, nguồn `github.list_pull_requests`. Câu tin nói không có PR đang mở.

Không gửi tin Slack.
