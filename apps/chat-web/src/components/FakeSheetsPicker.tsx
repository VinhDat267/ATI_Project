import { useEffect, useState } from 'react';

export interface FakePickerFile {
  id: string;
  name?: string;
  title?: string;
}

export interface FakeSheetsPickerProps {
  accessToken: string;
  fakePickerBaseUrl: string;
  maxItems?: number;
  initialSelectedIds?: string[];
  onSelect: (selectedIds: string[]) => void;
  onCancel: () => void;
}

export function FakeSheetsPicker({
  accessToken,
  fakePickerBaseUrl,
  maxItems = 10,
  initialSelectedIds = [],
  onSelect,
  onCancel,
}: FakeSheetsPickerProps) {
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<FakePickerFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);

  useEffect(() => {
    let active = true;
    const fetchFiles = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${fakePickerBaseUrl}/fake-picker/files`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (active) {
          const fileList: FakePickerFile[] = Array.isArray(data)
            ? data
            : Array.isArray(data?.files)
            ? data.files
            : [];
          setFiles(fileList);
        }
      } catch (err: any) {
        if (active) {
          setError('Không thể tải danh sách bảng tính từ máy chủ thử nghiệm.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchFiles();
    return () => {
      active = false;
    };
  }, [fakePickerBaseUrl, accessToken]);

  const toggleFile = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= maxItems) return prev;
      return [...prev, id];
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0 || granting) return;
    setGranting(true);
    setError('');
    try {
      // Grant each selected file
      for (const fileId of selectedIds) {
        const res = await fetch(`${fakePickerBaseUrl}/fake-picker/grant`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId }),
        });
        if (!res.ok) {
          throw new Error(`Failed to grant ${fileId}`);
        }
      }
      onSelect(selectedIds);
    } catch {
      setError('Không thể ghi nhận quyền cho bảng tính đã chọn. Hãy thử lại.');
      setGranting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chọn bảng tính Google Drive (Thử nghiệm)"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="bg-white rounded-2xl border border-[#E7E7E2] max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-[#111827]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E7E7E2] p-4 sm:p-5">
          <div>
            <h2 className="font-semibold text-base sm:text-lg">
              Google Drive — Chọn bảng tính
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Môi trường thử nghiệm (Sandbox Picker)
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Đóng cửa sổ chọn file"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-neutral-100 hover:text-[#111827] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 v3-space-y-4">
          {loading && (
            <p role="status" className="text-sm text-[#6B7280]">
              Đang tải danh sách file...
            </p>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-[#DC2626]">
              {error}
            </div>
          )}

          {!loading && files.length === 0 && !error && (
            <p className="text-sm text-[#6B7280]">
              Không tìm thấy bảng tính nào trong tài khoản.
            </p>
          )}

          {!loading && files.length > 0 && (
            <div className="v3-space-y-2" role="group" aria-label="Danh sách bảng tính Drive">
              {files.map((file) => {
                const isChecked = selectedIds.includes(file.id);
                const title = file.name || file.title || file.id;
                return (
                  <label
                    key={file.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      isChecked
                        ? 'border-[#FF5701] bg-[#FF5701]/5 ring-1 ring-[#FF5701]'
                        : 'border-[#E7E7E2] hover:border-neutral-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFile(file.id)}
                        className="w-4 h-4 text-[#FF5701] rounded border-[#E7E7E2] focus:ring-[#FF5701]"
                        aria-label={title}
                      />
                      <div className="min-w-0">
                        <span className="font-medium text-sm text-[#111827] block truncate">
                          {title}
                        </span>
                        <span className="text-xs text-[#6B7280] font-mono block truncate">
                          {file.id}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E7E7E2] p-4 flex items-center justify-end gap-3 bg-[#F8F8F6]">
          <button
            type="button"
            onClick={onCancel}
            disabled={granting}
            className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium bg-white text-[#4B5563] border border-[#E7E7E2] hover:bg-neutral-50 transition-colors disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selectedIds.length === 0 || granting || loading}
            className="px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm"
          >
            {granting ? 'Đang cấp quyền…' : `Chọn ${selectedIds.length > 0 ? `(${selectedIds.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
