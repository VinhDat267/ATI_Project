import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiClient, sharesAuthSession } from '../../services/api-client';
import { authStorage } from '../../services/auth-storage';
import { userErrorMessage } from '../../services/user-error';
import type { AccountProfile, AccountSession, User } from '../../types';
import { usePageDialog } from '../usePageDialog';

type ModalId = 'modal-revoke-all' | 'modal-unlink-google';
export function useAccount(user: User | null) {
  const [account, setAccount] = useState<AccountProfile | null>(null), [sessions, setSessions] = useState<AccountSession[]>([]);
  const [googleEnabled, setGoogleEnabled] = useState(false), [name, setName] = useState('');
  const [passwordLength, setPasswordLength] = useState(0);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalId | null>(null), [shownPasswords, setShownPasswords] = useState<string[]>([]);
  const fullNameRef = useRef<HTMLInputElement>(null), currentPassRef = useRef<HTMLInputElement>(null), newPassRef = useRef<HTMLInputElement>(null), confirmPassRef = useRef<HTMLInputElement>(null), unlinkPassRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0), active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async (owner = generation.current) => {
    const [profile, list] = await Promise.all([apiClient.getAccount(), apiClient.getAccountSessions()]);
    if (owner !== generation.current) return;
    setAccount(profile.account); setSessions(list.sessions); return profile.account;
  }, []);
  useEffect(() => {
    const owner = ++generation.current;
    load(owner).then(profile => { if (profile) setName(profile.name); }).catch(reason => { if (owner === generation.current) setError(userErrorMessage(reason, 'Không tải được thông tin tài khoản.')); });
    apiClient.getAuthConfig().then(config => { if (owner === generation.current) setGoogleEnabled(config.googleEnabled); }).catch(() => {});
    return () => { generation.current++; };
  }, [load, user?.id]);
  const run = async (key: string, action: (owner: number) => Promise<string | void>) => {
    if (active.current) return;
    active.current = true; setBusy(key); setError(null); setNotice(null);
    const owner = generation.current;
    try { const message = await action(owner); if (owner === generation.current && message) setNotice(message); }
    catch (reason) { if (owner === generation.current) setError(userErrorMessage(reason, 'Không thực hiện được thao tác. Hãy thử lại.')); }
    finally { active.current = false; if (mounted.current) setBusy(null); }
  };
  const closeModal = (_id?: string) => { if (!active.current) { setModal(null); if (unlinkPassRef.current) unlinkPassRef.current.value = ''; } };
  usePageDialog(modal, closeModal, busy !== null);
  const actions = {
    handleUpdateProfile(event: FormEvent) {
      event.preventDefault();
      const submitted = name, trimmed = name.trim();
      if (!trimmed || Array.from(trimmed).length > 100) { setNotice(null); setError('Tên phải có từ 1 đến 100 ký tự.'); return; }
      void run('name', async owner => {
        const { user: updated } = await apiClient.updateAccountName(trimmed);
        if (owner !== generation.current) return;
        authStorage.setStoredTokens({ user: { ...user, ...updated } });
        setName(current => current === submitted ? updated.name : current);
        await load(owner); return 'Đã lưu tên mới.';
      });
    },
    handleChangePassword(event: FormEvent) {
      event.preventDefault();
      const current = currentPassRef.current?.value ?? '', next = newPassRef.current?.value ?? '', repeat = confirmPassRef.current?.value ?? '';
      if (next.length < 12 || next.length > 128) { setNotice(null); setError('Mật khẩu mới phải có từ 12 đến 128 ký tự.'); return; }
      if (next !== repeat) { setNotice(null); setError('Hai lần nhập mật khẩu mới không khớp.'); return; }
      void run('password', async owner => {
        await apiClient.changePassword(current, next);
        if (owner !== generation.current) return;
        for (const [ref, submitted] of [[currentPassRef, current], [newPassRef, next], [confirmPassRef, repeat]] as const) if (ref.current?.value === submitted) ref.current.value = '';
        setPasswordLength(newPassRef.current?.value.length ?? 0);
        await load(owner); return 'Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.';
      });
    },
    togglePasswordVisibility(id: string) { setShownPasswords(list => list.includes(id) ? list.filter(value => value !== id) : [...list, id]); },
    revokeSingleSession(id: string, device: string) { void run(`session-${id}`, async owner => { await apiClient.revokeAccountSession(id); await load(owner); return `Đã đăng xuất ${device}.`; }); },
    promptRevokeAllOtherSessions() { setModal('modal-revoke-all'); },
    confirmRevokeAllOtherSessions() { void run('others', async owner => {
      const { revoked } = await apiClient.revokeOtherAccountSessions();
      if (owner !== generation.current) return;
      setModal(null); await load(owner); return revoked ? `Đã đăng xuất ${revoked} phiên khác.` : 'Không có phiên nào khác đang mở.';
    }); },
    promptUnlinkGoogleModal() { if (account?.hasPassword) setModal('modal-unlink-google'); },
    confirmUnlinkGoogle() {
      const password = unlinkPassRef.current?.value ?? '';
      if (!password) { setNotice(null); setError('Vui lòng nhập mật khẩu hiện tại để xác nhận gỡ liên kết.'); unlinkPassRef.current?.focus(); return; }
      void run('unlink', async owner => {
        await apiClient.unlinkGoogle(password);
        if (owner !== generation.current) return;
        setModal(null); await load(owner); return 'Đã gỡ liên kết Google.';
      });
    },
    triggerLinkGoogleFlow() { void run('link', async owner => {
      const initial = authStorage.getStoredTokens(), { url } = await apiClient.startGoogleAuth('link'), latest = authStorage.getStoredTokens();
      const sameSession = (latest.accessToken === initial.accessToken && latest.refreshToken === initial.refreshToken) || sharesAuthSession(initial.accessToken, latest.accessToken);
      if (owner !== generation.current || !latest.accessToken || !latest.refreshToken || latest.user?.id !== initial.user?.id || !sameSession) return;
      window.location.assign(url);
    }); },
    closeModal,
  };
  return { account, sessions, googleEnabled, name, setName, passwordLength, setPasswordLength, busy, error, notice, modal, shownPasswords, fullNameRef, currentPassRef, newPassRef, confirmPassRef, unlinkPassRef, actions };
}
