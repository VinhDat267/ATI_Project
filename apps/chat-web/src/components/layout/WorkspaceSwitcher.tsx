import React, { useEffect, useId, useRef, useState } from 'react';
import { apiClient } from '../../services/api-client';
import {
  getActiveWorkspaceId,
  getActiveWorkspaceSummary,
  getCachedOrganizations,
  setActiveWorkspaceId,
  setCachedOrganizations,
  subscribeWorkspace,
} from '../../services/workspace-storage';
import { useChatStore } from '../../store/chat-store';
import { authStorage } from '../../services/auth-storage';
import type { WorkspaceSummary } from '../../types';

export interface WorkspaceSwitcherProps {
  navigate?: (path: string) => void;
}

export function WorkspaceSwitcher({ navigate }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [activeSummary, setActiveSummary] = useState(getActiveWorkspaceSummary());
  const [organizations, setOrganizations] = useState<WorkspaceSummary[]>(getCachedOrganizations());
  
  // Modals / forms state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [requireApproval, setRequireApproval] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Subscribe to storage changes
  useEffect(() => {
    return subscribeWorkspace(() => {
      setActiveSummary(getActiveWorkspaceSummary());
      setOrganizations(getCachedOrganizations());
    });
  }, []);

  // Fetch workspaces list from API on mount
  useEffect(() => {
    let current = true;
    const { accessToken } = authStorage.getStoredTokens();
    if (accessToken && typeof apiClient.getWorkspaces === 'function') {
      apiClient
        .getWorkspaces()
        .then((res) => {
          if (!current) return;
          if (Array.isArray(res?.organizations)) {
            setCachedOrganizations(res.organizations);
            setOrganizations(res.organizations);
          }
        })
        .catch(() => {});
    }
    return () => {
      current = false;
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const handleSelectWorkspace = (id: string) => {
    if (id === getActiveWorkspaceId()) {
      setOpen(false);
      return;
    }
    setActiveWorkspaceId(id);
    useChatStore.getState().reset();
    navigate?.('/');
    setOpen(false);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = createName.trim();
    if (!trimmed) {
      setCreateError('Vui lòng nhập tên tổ chức.');
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await apiClient.createWorkspace(trimmed, requireApproval);
      if (res?.workspace) {
        const nextOrgs = [...getCachedOrganizations().filter((o) => o.id !== res.workspace.id), res.workspace];
        setCachedOrganizations(nextOrgs);
        setActiveWorkspaceId(res.workspace.id);
        useChatStore.getState().reset();
        navigate?.('/');
        setShowCreateModal(false);
        setCreateName('');
        setOpen(false);
      }
    } catch (err: any) {
      setCreateError(err?.data?.error || err?.message || 'Không thể tạo không gian tổ chức.');
    } finally {
      setCreateBusy(false);
    }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = joinCode.trim();
    if (!trimmed) {
      setJoinError('Vui lòng nhập mã mời.');
      return;
    }
    setJoinBusy(true);
    setJoinError(null);
    setJoinNotice(null);
    try {
      const res = await apiClient.joinWorkspace(trimmed);
      if (res?.workspace) {
        const nextOrgs = [...getCachedOrganizations().filter((o) => o.id !== res.workspace.id), res.workspace];
        setCachedOrganizations(nextOrgs);
        if (res.workspace.status === 'active') {
          setActiveWorkspaceId(res.workspace.id);
          useChatStore.getState().reset();
          navigate?.('/');
          setShowJoinModal(false);
          setJoinCode('');
          setOpen(false);
        } else {
          setJoinNotice(
            `Đã gửi yêu cầu tham gia ${res.workspace.name}. Bạn vẫn đang làm việc bình thường tại Không gian Cá nhân trong lúc chờ Admin duyệt.`
          );
        }
      }
    } catch (err: any) {
      setJoinError(err?.data?.error || err?.message || 'Mã mời không hợp lệ hoặc đã hết hạn.');
    } finally {
      setJoinBusy(false);
    }
  };

  const isPersonal = activeSummary.id === 'personal';

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Không gian làm việc: ${activeSummary.name}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-[#E7E7E2] bg-white hover:bg-[#F8F8F6] text-[#111827] shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-[#FF5701]"
      >
        <span className="truncate max-w-[140px] sm:max-w-[180px] flex items-center gap-1">
          <span>{isPersonal ? '👤' : '🏢'}</span>
          <span className="font-semibold">{activeSummary.name}</span>
        </span>
        {!isPersonal && (
          <span
            className={`px-1.5 py-0.2 rounded text-[10px] font-medium ${
              activeSummary.role === 'admin'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            {activeSummary.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-[#6B7280] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Danh sách không gian làm việc"
          className="absolute left-0 top-full mt-1.5 w-72 sm:w-80 bg-white rounded-xl border border-[#E7E7E2] shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6B7280]">
            Không gian làm việc
          </div>

          {/* Personal Workspace option */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleSelectWorkspace('personal')}
            className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between transition-colors ${
              isPersonal ? 'bg-orange-50/80 font-semibold text-[#FF5701]' : 'hover:bg-neutral-50 text-[#111827]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">👤</span>
              <div>
                <div>Không gian Cá nhân</div>
                <div className="text-[10px] text-[#6B7280]">Gmail, Lịch, Trello & công cụ riêng</div>
              </div>
            </div>
            {isPersonal && <span className="text-sm font-bold text-[#FF5701]">✓</span>}
          </button>

          {/* Organizations List */}
          <div className="mt-2 border-t border-[#E7E7E2] pt-1">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6B7280] flex items-center justify-between">
              <span>Tổ chức của bạn</span>
              <span className="text-[10px] font-normal text-neutral-400">{organizations.length}</span>
            </div>

            {organizations.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#9CA3AF] italic">Bạn chưa tham gia tổ chức nào.</div>
            ) : (
              organizations.map((org) => {
                const isSelected = activeSummary.id === org.id;
                const isPending = org.status === 'pending';
                const isDisabled = org.status === 'disabled';

                return (
                  <button
                    key={org.id}
                    type="button"
                    role="menuitem"
                    disabled={isPending || isDisabled}
                    onClick={() => handleSelectWorkspace(org.id)}
                    className={`w-full text-left px-3.5 py-2 text-xs flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-orange-50/80 font-semibold text-[#FF5701]'
                        : isPending || isDisabled
                        ? 'opacity-60 cursor-not-allowed bg-neutral-50/50 text-[#6B7280]'
                        : 'hover:bg-neutral-50 text-[#111827]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base flex-shrink-0">🏢</span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{org.name}</div>
                        <div className="text-[10px] text-[#6B7280] flex items-center gap-1.5">
                          <span>{org.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}</span>
                          {isPending && <span className="text-amber-600 font-medium">· Đang chờ duyệt</span>}
                          {isDisabled && <span className="text-red-600 font-medium">· Đã khóa</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {org.role === 'admin' && typeof org.pendingCount === 'number' && org.pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FF5701] text-white">
                          {org.pendingCount}
                        </span>
                      )}
                      {isSelected && <span className="text-sm font-bold text-[#FF5701]">✓</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-2 border-t border-[#E7E7E2] pt-1.5 px-2 v3-space-y-1">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(true);
                setCreateError(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] hover:text-[#FF5701] transition-colors flex items-center gap-2"
            >
              <span className="font-bold text-[#FF5701]">+</span>
              <span>Tạo không gian tổ chức mới</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowJoinModal(true);
                setJoinError(null);
                setJoinNotice(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#111827] hover:bg-[#F8F8F6] hover:text-[#FF5701] transition-colors flex items-center gap-2"
            >
              <span>🔑</span>
              <span>Tham gia tổ chức bằng mã mời</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Tạo Không Gian Tổ Chức */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#E7E7E2] shadow-2xl p-6 v3-space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111827] flex items-center gap-2">
                <span>🏢</span>
                <span>Tạo không gian tổ chức mới</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-[#9CA3AF] hover:text-[#111827] text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="v3-space-y-4">
              <div>
                <label htmlFor="create-org-name" className="block text-xs font-semibold text-[#111827] mb-1.5">
                  Tên tổ chức
                </label>
                <input
                  id="create-org-name"
                  type="text"
                  required
                  placeholder="Nhập tên tổ chức (ví dụ: Công ty ABC, Đội Alpha)..."
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-[#E7E7E2] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] outline-none"
                />
              </div>

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  id="create-org-approval"
                  type="checkbox"
                  checked={requireApproval}
                  onChange={(e) => setRequireApproval(e.target.checked)}
                  className="mt-0.5 rounded border-[#E7E7E2] text-[#FF5701] focus:ring-[#FF5701]"
                />
                <label htmlFor="create-org-approval" className="text-xs text-[#4B5563] cursor-pointer">
                  <span className="font-semibold text-[#111827] block">Cần Quản trị viên duyệt thành viên mới</span>
                  <span>Khi tắt, bất kỳ ai có mã mời đều được vào làm việc ngay lập tức mà không cần phê duyệt.</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E7E7E2]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#4B5563] hover:bg-neutral-100"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={createBusy}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] shadow-sm disabled:opacity-50"
                >
                  {createBusy ? 'Đang tạo...' : 'Xác nhận tạo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tham Gia Bằng Mã Mời */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#E7E7E2] shadow-2xl p-6 v3-space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111827] flex items-center gap-2">
                <span>🔑</span>
                <span>Tham gia tổ chức bằng mã mời</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="text-[#9CA3AF] hover:text-[#111827] text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            {joinError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600">
                {joinError}
              </div>
            )}

            {joinNotice && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
                {joinNotice}
              </div>
            )}

            <form onSubmit={handleJoinSubmit} className="v3-space-y-4">
              <div>
                <label htmlFor="join-org-code" className="block text-xs font-semibold text-[#111827] mb-1.5">
                  Mã mời tổ chức
                </label>
                <input
                  id="join-org-code"
                  type="text"
                  required
                  placeholder="ATI-XXXX-XXXX"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs sm:text-sm font-mono uppercase tracking-wider rounded-xl border border-[#E7E7E2] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] outline-none"
                />
                <p className="text-[11px] text-[#6B7280] mt-1">
                  Nhập mã mời được quản trị viên tổ chức cung cấp (định dạng ATI-XXXX-XXXX).
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E7E7E2]">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#4B5563] hover:bg-neutral-100"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={joinBusy}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] shadow-sm disabled:opacity-50"
                >
                  {joinBusy ? 'Đang kiểm tra...' : 'Tham gia ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
