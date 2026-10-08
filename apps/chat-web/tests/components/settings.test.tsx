/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsPage } from '../../src/pages/Settings/SettingsPage';
const settingsProps = { user: { id: 'admin', email: 'admin@localhost.test', name: 'Test Admin', role: 'admin' as const }, navigate: () => {}, onLogout: () => {} };


afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The former SettingsModal cases follow the page/drawer contract.
describe('SettingsPage (migrated SettingsModal behavior)', () => {
  const trello = { id:'trello',name:'Trello',configured:false,connected:false,tools:[],allowedScope:[],scopeLabel:'Board ID',credentialFields:[{key:'apiKey',label:'API Key / Client ID'},{key:'token',label:'OAuth / API Token'}] };
  const install = (entries = [trello], saveMessage = 'Saved', onSave = () => {}) => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/services') return new Response(JSON.stringify({services:entries,canConfigure:true}));
      if (url.endsWith('/test')) return new Response(JSON.stringify({status:'unhealthy',message:'Provider unavailable'}),{status:503});
      if (url.endsWith('/credentials')) { onSave(); return new Response(JSON.stringify({success:true,message:saveMessage})); }
      throw new Error('Unexpected endpoint');
    });
    vi.stubGlobal('fetch',fetchMock); return fetchMock;
  };
  const open = async (name = 'Trello') => { fireEvent.click(await screen.findByRole('button',{name:new RegExp(`${name} —`)})); };
  const add = (label:string,value:string) => { fireEvent.change(screen.getByLabelText(`Thêm ${label}`),{target:{value}}); fireEvent.click(screen.getByRole('button',{name:'Thêm'})); };
  it('uses configured instead of provider verification and refreshes after saving', async () => {
    const entries=[{...trello,configured:true}];
    const fetchMock=install(entries, 'Saved', () => { entries[0].configured=false; }); render(<SettingsPage {...settingsProps}/>); await open();
    expect(screen.getByRole('dialog')).toHaveTextContent('Chưa kiểm tra');
    fireEvent.change(screen.getByLabelText('API Key / Client ID'),{target:{value:'synthetic-key'}}); fireEvent.change(screen.getByLabelText('OAuth / API Token'),{target:{value:'synthetic-token'}}); add('Board ID','B1');
    fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'})); await screen.findByText(/Saved/);
    await waitFor(()=>expect(fetchMock.mock.calls.filter(([url])=>url==='/api/services')).toHaveLength(2));
    await waitFor(()=>expect(document.getElementById('drawer-header-status-badge')).toHaveTextContent('Chưa kết nối'));
  });
  it('renders multiple service rows and closes the detail drawer', async () => {
    install([trello,{...trello,id:'slack',name:'Slack'}]); render(<SettingsPage {...settingsProps}/>); await open();
    fireEvent.click(screen.getByRole('button',{name:'Đóng ngăn chi tiết'})); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('button',{name:/Slack —/})).toBeInTheDocument();
  });
  it('closes the drawer on Escape', async () => { install(); render(<SettingsPage {...settingsProps}/>); await open(); fireEvent.keyDown(window,{key:'Escape'}); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
  it('closes on backdrop but not content click', async () => { install(); render(<SettingsPage {...settingsProps}/>); await open(); fireEvent.click(screen.getByRole('heading',{name:'Trello',level:2})); expect(screen.getByRole('dialog')).toBeInTheDocument(); fireEvent.click(document.getElementById('drawer-backdrop')!); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
  it('reports the API test failure instead of a success fallback', async () => { install([{...trello,configured:true}]); render(<SettingsPage {...settingsProps}/>); await open(); fireEvent.click(screen.getByRole('button',{name:'Kiểm tra kết nối'})); expect(await screen.findByText('Provider unavailable')).toBeInTheDocument(); expect(screen.queryByText(/Kết nối tốt|Kết nối thành công/)).not.toBeInTheDocument(); });
  it('posts all Trello credentials and scope and reports save feedback', async () => {
    const fetchMock=install(); render(<SettingsPage {...settingsProps}/>); await open();
    fireEvent.change(screen.getByLabelText('API Key / Client ID'),{target:{value:'key-123'}}); fireEvent.change(screen.getByLabelText('OAuth / API Token'),{target:{value:'token-456'}}); add('Board ID','board-789'); fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'}));
    await screen.findByText(/Saved/); expect(fetchMock).toHaveBeenCalledWith('/api/services/trello/credentials',expect.objectContaining({method:'POST',body:JSON.stringify({credentials:{apiKey:'key-123',token:'token-456'},allowedScope:['board-789']})}));
  });
  it('sends Slack botToken under the API field key', async () => {
    const fetchMock=install([{...trello,id:'slack',name:'Slack',scopeLabel:'Channel ID',credentialFields:[{key:'botToken',label:'Bot Token'}]}]); render(<SettingsPage {...settingsProps}/>); await open('Slack');
    fireEvent.change(screen.getByLabelText('Bot Token'),{target:{value:'xoxb-example'}}); add('Channel ID','C1'); fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'})); await screen.findByText(/Saved/);
    expect(fetchMock).toHaveBeenCalledWith('/api/services/slack/credentials',expect.objectContaining({body:JSON.stringify({credentials:{botToken:'xoxb-example'},allowedScope:['C1']})}));
  });
  it('renders GitHub API fields and saves repository scope', async () => {
    const fetchMock=install([{...trello,id:'github',name:'GitHub',scopeLabel:'Repository',credentialFields:[{key:'token',label:'Personal Access Token'}]}],'GitHub saved'); render(<SettingsPage {...settingsProps}/>); await open('GitHub');
    fireEvent.change(screen.getByLabelText('Personal Access Token'),{target:{value:'ghp-example'}}); add('Repository','owner/repo'); fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'})); await screen.findByText(/GitHub saved/);
    expect(fetchMock).toHaveBeenCalledWith('/api/services/github/credentials',expect.objectContaining({body:JSON.stringify({credentials:{token:'ghp-example'},allowedScope:['owner/repo']})}));
  });
});
