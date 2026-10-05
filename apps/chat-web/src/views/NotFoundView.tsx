export function NotFoundView({ message = 'Không tìm thấy trang.', onGoHome }: { message?: string; onGoHome: () => void }) {
  return <div className="p-6 text-sm"><p role="alert">{message}</p><button type="button" onClick={onGoHome} className="mt-4 text-primary-text">Về trang chính</button></div>;
}
