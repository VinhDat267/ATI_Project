export function NotFoundView({ message = 'Không tìm thấy trang.', onGoHome }: { message?: string; onGoHome: () => void }) {
  return <div className="p-6 text-sm"><h1 className="font-display text-2xl">Không mở được hội thoại</h1><p role="alert" className="mt-2">{message}</p><button type="button" onClick={onGoHome} className="mt-4 text-primary-text">Về trang chính</button></div>;
}
