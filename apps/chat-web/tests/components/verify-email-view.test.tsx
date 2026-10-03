/** @vitest-environment jsdom */
import {StrictMode} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {VerifyEmailView} from '../../src/components/VerifyEmailView';
import {apiClient} from '../../src/services/api-client';
afterEach(()=>{cleanup();vi.restoreAllMocks();window.history.replaceState({},'','/');});
it('removes the URL token and verifies once under StrictMode; communicates waiting for approval',async()=>{
  window.history.replaceState({},'','/?view=verify-email&token=fixture-token');
  const verify=vi.spyOn(apiClient,'verifyEmail').mockResolvedValue({message:'Email đã xác minh. Tài khoản đang chờ quản trị viên duyệt.'});
  render(<StrictMode><VerifyEmailView token="fixture-token" onLogin={vi.fn()} onBackToLanding={vi.fn()}/></StrictMode>);
  expect(location.search).not.toContain('token');
  expect(await screen.findByRole('heading',{name:'Email đã xác minh.'})).toBeInTheDocument();
  expect(verify).toHaveBeenCalledTimes(1);expect(screen.getByRole('status')).toHaveTextContent('chờ quản trị viên');
});
