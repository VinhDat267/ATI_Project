import type { FakeService } from './types.js';

const databaseId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const pageId = '22222222-3333-4444-5555-666666666666';
const pageUrl = 'https://www.notion.so/' + pageId.replaceAll('-', '');
export const NOTION_FAKE: FakeService = {
  id: 'notion', tools: {
    'notion.search_databases': () => [{ id: databaseId, title: 'ATI Notes', url: 'https://www.notion.so/' + databaseId.replaceAll('-', '') }],
    'notion.query_database': () => ({ pages: [{ id: pageId, title: 'ATI Review', url: pageUrl, properties: { Name: 'ATI Review' } }] }),
    'notion.create_page': () => ({ id: pageId, url: pageUrl }),
    'notion.append_text': args => ({ pageId: args.pageId, blockIds: ['33333333-4444-5555-6666-777777777777'], url: pageUrl }),
  },
};
