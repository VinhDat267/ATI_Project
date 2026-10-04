import { expect, it } from 'vitest';

it.each([
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Chrome trên Windows'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', 'Edge trên Windows'],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox trên Linux'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari trên macOS'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari trên iOS'],
  ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36', 'Chrome trên Android'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36', 'Chrome trên Windows'],
  ['curl/8.9.1', 'Trình duyệt không rõ'],
  [null, 'Thiết bị không rõ'],
  ['', 'Thiết bị không rõ'],
])('describes %j as %j', async (agent, expected) => {
  const path = '../../src/auth/user-agent.js';
  const module: any = await import(path).catch(() => ({}));
  expect(module.describeUserAgent).toBeTypeOf('function');
  expect(module.describeUserAgent(agent)).toBe(expected);
});
