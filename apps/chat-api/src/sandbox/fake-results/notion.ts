import type { FakeService } from './types.js';

const databaseId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const pageId = '22222222-3333-4444-5555-666666666666';
const pageUrl = 'https://www.notion.so/' + pageId.replaceAll('-', '');
export const NOTION_FAKE: FakeService = {
  id: 'notion', tools: {
    'notion.search_databases': () => [{ id: databaseId, title: 'ATI Notes', url: 'https://www.notion.so/' + databaseId.replaceAll('-', '') }],
    'notion.query_database': () => ({
      pages: [{ id: pageId, title: 'ATI Review', url: pageUrl, properties: { Name: 'ATI Review', Status: 'In progress' } }],
      schema: [{ name: 'Name', type: 'title' }, { name: 'Status', type: 'status', options: ['Not started', 'In progress', 'Done'] }],
    }),
    'notion.create_page': () => ({ id: pageId, url: pageUrl }),
    'notion.append_text': args => ({ pageId: args.pageId, blockIds: ['33333333-4444-5555-6666-777777777777'], url: pageUrl }),
    'notion.get_page': args => ({
      id: args.pageId || pageId,
      title: 'ATI Review',
      url: pageUrl,
      properties: { Name: 'ATI Review', Status: 'In progress' },
      content: '## Mục tiêu Sprint\n- [x] Hoàn thiện Notion OAuth\n- Đồng bộ tiến độ sang Trello',
      blocks: [
        { id: '33333333-4444-5555-6666-777777777777', type: 'heading_2', text: 'Mục tiêu Sprint' },
        { id: '44444444-5555-6666-7777-888888888888', type: 'to_do', text: 'Hoàn thiện Notion OAuth', checked: true },
      ],
    }),
    'notion.update_page': args => ({
      id: args.pageId || pageId,
      url: pageUrl,
      updatedProperties: Object.keys(args.properties ?? {}),
      ...(typeof args.archived === 'boolean' ? { archived: args.archived } : {}),
    }),
    'notion.get_database': args => ({
      id: args.databaseId || databaseId,
      title: 'ATI Notes',
      url: 'https://www.notion.so/' + databaseId.replaceAll('-', ''),
      schema: [{ name: 'Name', type: 'title' }, { name: 'Status', type: 'status', options: ['Not started', 'In progress', 'Done'] }],
    }),
    'notion.search_pages': args => ({
      pages: [{
        id: pageId,
        databaseId: args.databaseId || databaseId,
        title: 'ATI Review',
        url: pageUrl,
      }],
    }),
    'notion.append_blocks': args => ({
      pageId: args.pageId || pageId,
      blockIds: ['33333333-4444-5555-6666-777777777777'],
      blockCount: 1,
      url: pageUrl,
    }),
    'notion.list_comments': args => ({
      comments: [{
        id: '55555555-6666-7777-8888-999999999999',
        pageId: args.pageId || pageId,
        author: 'Sandbox User',
        text: 'Đã kiểm tra xong tài liệu.',
      }],
    }),
    'notion.add_comment': args => ({
      id: '55555555-6666-7777-8888-999999999999',
      pageId: args.pageId || pageId,
      url: pageUrl,
    }),
  },
};
