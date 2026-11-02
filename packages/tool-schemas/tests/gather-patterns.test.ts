import { describe, it, expect } from 'vitest';
import { SERVICE_REGISTRY } from '../src/index.js';

const board = SERVICE_REGISTRY.find((service) => service.id === 'trello')!.gatherRules!.find((rule) => rule.entityKey === 'board')!;

describe('Trello board gather pattern', () => {
  it.each(['ghi một dòng vào bảng tính Google Sheets', 'cập nhật BẢNG TÍNH chung'])('does not read a spreadsheet as a board: %s', (message) => {
    expect(board.pattern.exec(message)).toBeNull();
  });

  it.each([
    ['Tạo card trên bảng Frontend', 'Frontend'],
    ['Tạo card trên bảng tínhtoán', 'tínhtoán'],
    ['Tạo card trên bảng tính-toán', 'tính-toán'],
    ['Create a card on board "Sprint-1"', 'Sprint-1'],
  ])('still reads the board name in "%s"', (message, name) => {
    expect(board.pattern.exec(message)?.[1]).toBe(name);
  });
});
