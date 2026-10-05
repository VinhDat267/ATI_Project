import { fireEvent, screen } from '@testing-library/react';
export function closeCockpitDialog() {
  const dialog = screen.queryByRole('dialog');
  if (dialog) fireEvent.keyDown(document, { key:'Escape' });
}
export async function openHistory() {
  closeCockpitDialog();
  fireEvent.click(await screen.findByRole('button', { name:'Mở danh sách hội thoại' }));
}
export async function transcriptText(text: string) {
  if (screen.queryByText(text)) return screen.getByText(text);
  closeCockpitDialog();
  fireEvent.click(await screen.findByRole('button', { name:'Nhật ký hội thoại' }));
  return screen.findByText(text);
}
