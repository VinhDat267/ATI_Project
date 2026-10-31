/** @vitest-environment jsdom */
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SlackReadControls } from '../src/pages/Cockpit/SlackReadControls';
import { slackConnectionApi, type SlackConnection } from '../src/services/slack-connection';
import { authStorage } from '../src/services/auth-storage';
const connection = (id: string) => ({ id, workspaceId: 'T_'+id, workspaceName: 'Workspace '+id, slackUserId: 'U_ME', slackUserLabel: 'Lan', status: 'active' } as SlackConnection);
function View(){const [value,setValue]=useState<string|null>(null);return <><SlackReadControls userId="owner" busy={false} value={value} onChange={setValue}/><output data-testid="selection">{value ?? 'off'}</output></>;}
beforeEach(()=>authStorage.setStoredTokens({accessToken:'token',user:{id:'owner'} as any}));
afterEach(()=>{cleanup();vi.restoreAllMocks();authStorage.clearStoredTokens();});
it('makes no connection request while off and selects a sole workspace after opting in',async()=>{
 const list=vi.spyOn(slackConnectionApi,'list').mockResolvedValue({connections:[connection('one')]});
 render(<View/>);expect(list).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Tra cứu Slack của bạn'}));
 await waitFor(()=>expect((screen.getByLabelText('Workspace Slack') as HTMLSelectElement).value).toBe('one'));
 expect(screen.getByTestId('selection').textContent).toBe('one');
});
it('requires explicit selection for multiple workspaces and does not reuse an old selection on re-entry',async()=>{
 vi.spyOn(slackConnectionApi,'list').mockResolvedValue({connections:[connection('one'),connection('two')]});
 render(<View/>);const toggle=screen.getByRole('button',{name:'Tra cứu Slack của bạn'});fireEvent.click(toggle);
 const select=await screen.findByLabelText('Workspace Slack');expect((select as HTMLSelectElement).value).toBe('');
 fireEvent.change(select,{target:{value:'two'}});expect(screen.getByTestId('selection').textContent).toBe('two');
 fireEvent.click(toggle);fireEvent.click(toggle);
 await waitFor(()=>expect((screen.getByLabelText('Workspace Slack') as HTMLSelectElement).value).toBe(''));
});
it('ignores a workspace list that arrives after the owner changes',async()=>{
 let finish!:(value:any)=>void;vi.spyOn(slackConnectionApi,'list').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<View/>);fireEvent.click(screen.getByRole('button',{name:'Tra cứu Slack của bạn'}));
 authStorage.setStoredTokens({accessToken:'other',user:{id:'other'} as any});finish({connections:[connection('late')]});
 await new Promise(resolve=>setTimeout(resolve,0));expect(screen.queryByText(/Workspace late/)).toBeNull();expect(screen.getByTestId('selection').textContent).toBe('');
});
