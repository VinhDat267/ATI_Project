// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import { RequestMoment } from '../../src/pages/Cockpit/RequestMoments';
import { authStorage } from '../../src/services/auth-storage';
import { setActiveWorkspaceId, setCachedOrganizations } from '../../src/services/workspace-storage';
import { loadWorkflowDefaults, saveWorkflowDefaults } from '../../src/services/workflow-defaults-storage';
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'r', user: { id: 'u1', email: 'one@example.com', name: 'One', role: 'admin' } });
  setActiveWorkspaceId('personal'); setCachedOrganizations([{ id: 'team', name: 'Team', role: 'admin', status: 'active' }]);
});
afterEach(cleanup);
it.each(['workspace', 'account'])('discards an open defaults draft when changing %s', (scope) => {
  saveWorkflowDefaults('u1', 'personal', { github: { repo: 'personal/existing' } });
  render(<RequestMoment services={[]} loading={false} error={null} draft="" planning={false} input={createRef<HTMLTextAreaElement>()} onDraft={vi.fn()} onSend={vi.fn()} onKeyDown={() => { }} onSettings={() => { }} navigate={() => { }} servicePrompt={() => ''} />);
  fireEvent.click(screen.getByTestId('btn-open-workflow-defaults'));
  fireEvent.change(screen.getByDisplayValue('personal/existing'), { target: { value: 'private/personal-draft' } });
  act(() => scope === 'workspace' ? setActiveWorkspaceId('team') : authStorage.setStoredTokens({ accessToken: 'b', refreshToken: 's', user: { id: 'u2', email: 'two@example.com', name: 'Two', role: 'admin' } }));
  expect(screen.queryByTestId('btn-save-workflow-defaults')).toBeNull();
  expect(loadWorkflowDefaults(scope === 'workspace' ? 'u1' : 'u2', scope === 'workspace' ? 'team' : 'personal')).toBeNull();
  fireEvent.click(screen.getByTestId('btn-open-workflow-defaults'));
  expect(screen.queryByDisplayValue('private/personal-draft')).toBeNull();
  expect(loadWorkflowDefaults('u1', 'personal')).toEqual({ github: { repo: 'personal/existing' } });
});
