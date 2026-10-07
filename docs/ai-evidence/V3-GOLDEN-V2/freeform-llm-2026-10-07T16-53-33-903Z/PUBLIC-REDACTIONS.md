# Lọc chuỗi trùng corpus ở bản public

Source model/scoring `50761b16ff3f87d7160b533cbc77e387eea3e972`.
Exporter lọc nguyên prompt của case đang chạy sau scoring. Scan bổ sung toàn
112 prompt còn khớp một chuỗi21ký tự/4từ của core cl07 trong response ff04
freeform: đây là cụm hành động chung giữa hai bộ, cl07 không được đưa làm input
cho ff04. Để bản public không chứa nguyên prompt nào trong corpus, thay đúng
cụm khớp bằng `[redacted corpus phrase]` ở hai field:

- ff04 run2: `response.steps[0].description`.
- ff04 run3: `response.summary`.

Không thay arguments, kind, steps/tool, searches, scores, timing, usage hoặc
metadata; deep-compare xác minh mọi field khác giữ nguyên. Summary tổng hợp
không đổi, không sửa phản hồi sản phẩm hay input/labels. Đây là thao tác lọc
bản evidence, không phải thay đổi planner sau phép đo.

- SHA-256 trước lọc bổ sung: `64291cfe87f0f05e619913eb8a5015b5f56b351bd2f062384980fb5c21faf950`.
- SHA-256 public: `c45a292140059165ffb38bfcb245f03b4b289e2a2427c8c53a32a65db8c70d8b`.

Bản chứa các chuỗi chưa lọc không được commit.
