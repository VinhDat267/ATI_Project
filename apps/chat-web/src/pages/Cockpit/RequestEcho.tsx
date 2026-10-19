// FE-12: câu yêu cầu rời thanh trên và nằm ngay trên tiêu đề của khoảnh khắc, để đối chiếu khi duyệt.
// Không có trong bản mẫu. Cắt ở 2 dòng chỉ là hiển thị; toàn văn vẫn trong DOM và trong title.
export function RequestEcho({ request }: { request?: string }) {
  if (!request?.trim()) return null;
  return (
    <p data-request-echo title={request} className="text-xs text-[#6B7280] leading-relaxed line-clamp-2 break-words">
      Bạn nhờ: “<span className="text-[#111827] font-medium">{request}</span>”
    </p>
  );
}
