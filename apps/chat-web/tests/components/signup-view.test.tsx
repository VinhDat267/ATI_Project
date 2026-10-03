/** @vitest-environment jsdom */
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {SignupView} from '../../src/components/SignupView';
import {apiClient} from '../../src/services/api-client';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const props={onLogin:vi.fn(),onBackToLanding:vi.fn(),signupEnabled:true};
const fill=()=>{
  fireEvent.change(screen.getByLabelText('Tên của bạn'),{target:{value:'Linh'}});
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'linh@planora.test'}});
  fireEvent.change(screen.getByLabelText('Mật khẩu'),{target:{value:'Test-password-long-enough'}});
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'),{target:{value:'Test-password-long-enough'}});
};
describe('registration UI',()=>{
  it('blocks mismatched passwords and does not submit until corrected',()=>{
    const signup=vi.spyOn(apiClient,'signup').mockResolvedValue({message:'Sent'});
    render(<SignupView {...props}/>);fill();
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'),{target:{value:'Different-password'}});
    fireEvent.submit(screen.getByRole('form',{name:'Tạo tài khoản Planora'}));
    expect(screen.getByRole('alert')).toHaveTextContent('chưa khớp');expect(signup).not.toHaveBeenCalled();
  });
  it('waits for real API success, prevents duplicate requests, clears passwords and shows verification instructions',async()=>{
    let resolve!:(value:{message:string})=>void;
    const signup=vi.spyOn(apiClient,'signup').mockImplementation(()=>new Promise(r=>{resolve=r;}));
    render(<SignupView {...props}/>);fill();
    const form=screen.getByRole('form',{name:'Tạo tài khoản Planora'});
    fireEvent.submit(form);fireEvent.submit(form);
    expect(signup).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:/Đang tạo tài khoản/})).toBeDisabled();
    resolve({message:'Accepted'});
    expect(await screen.findByRole('heading',{name:'Kiểm tra email của bạn.'})).toBeInTheDocument();
    expect(screen.queryByLabelText('Mật khẩu')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('quản trị viên');
  });
  it('keeps editable fields and a clear error on API failure; closed registration cannot submit',async()=>{
    vi.spyOn(apiClient,'signup').mockRejectedValue(new Error('Không kết nối được máy chủ.'));
    const {rerender}=render(<SignupView {...props}/>);fill();fireEvent.submit(screen.getByRole('form',{name:'Tạo tài khoản Planora'}));
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Không kết nối'));
    expect(screen.getByLabelText('Email')).toHaveValue('linh@planora.test');
    rerender(<SignupView {...props} signupEnabled={false}/>);
    expect(screen.queryByRole('form')).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('chưa khả dụng');
  });
});
