/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ResultFields } from '../src/components/ExecutionProgress';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';

afterEach(cleanup);
it('shows Slack message text without rendering internal observation or policy metadata', () => {
  const { container } = render(<ResultFields tool="myslack.conversations_history" output={{ messages: [{ text: 'Tin nhắn của Lan', user: 'U_LAN', ts: '1730000000.000001', provenance: { secret: 'INTERNAL_SOURCE_SENTINEL' } }], provenance: { policy: 'INTERNAL_POLICY_SENTINEL' } }} />);
  expect(screen.getByText('Tin nhắn của Lan')).toBeDefined();
  expect(container.textContent).not.toContain('INTERNAL_');
  expect(container.querySelector('pre')).toBeNull();
});
it('shows member IDs and empty collections as usable read results', () => {
  const { rerender } = render(<ResultFields tool="myslack.conversations_members" output={{ members: ['U_LAN', 'U_NAM'] }} />);
  expect(screen.getByText('U_LAN')).toBeDefined();
  rerender(<ResultFields tool="myslack.conversations_list" output={{ channels: [] }} />);
  expect(screen.getByText('Không có kết quả trong phạm vi đã duyệt.')).toBeDefined();
});
it('keeps internal source records out of the complete receipt DOM, including technical details', () => {
  const {container}=render(<ReceiptMoment steps={[{id:'step_1',tool:'myslack.users_info',description:'Đọc hồ sơ',status:'succeeded',output:{user:{id:'U_LAN',name:'Lan',provenance:{secret:'RECEIPT_INTERNAL_SENTINEL'}}}}]} planSteps={[]} services={[]} destination={()=>'Workspace'} onNewConversation={()=>{}} onFollowup={()=>{}} servicePrompt={()=>''} onSettings={()=>{}} servicesLoading={false} servicesError={null}/>);
  expect(screen.getByText('Lan')).toBeDefined();
  expect(container.textContent).not.toContain('RECEIPT_INTERNAL_SENTINEL');
});
