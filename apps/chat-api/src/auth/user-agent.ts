// Short device label for the account page; the raw User-Agent never leaves the server.
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/Firefox\/|FxiOS\//, 'Firefox'],
  [/(?:Headless)?Chrome\/|CriOS\//, 'Chrome'], [/Version\/[\d.]+.*Safari\//, 'Safari'],
];
// iOS and Android agents also mention Mac OS X and Linux, so they are tested first.
const SYSTEMS: Array<[RegExp, string]> = [
  [/Windows NT/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'], [/CrOS/, 'ChromeOS'], [/Linux|X11/, 'Linux'],
];

export function describeUserAgent(agent: string | null | undefined): string {
  if (!agent?.trim()) return 'Thiết bị không rõ';
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ?? 'Trình duyệt không rõ';
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  return system ? `${browser} trên ${system}` : browser;
}
