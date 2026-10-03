export function RuntimeNotice({ mode }: { mode?: string }) {
  if (mode === "live" || mode === "sandbox") return null;
  return (
    <div className="mode-notice" role="status">
      Chưa xác định môi trường thực thi. Kiểm tra cấu hình trước khi duyệt kế hoạch.
    </div>
  );
}
