import type { ServiceDefinition } from '../types.js';
import { TRELLO_SERVICE } from './trello.js';
import { SLACK_SERVICE } from './slack.js';
import { GITHUB_SERVICE } from './github.js';
import { SHEETS_SERVICE } from './sheets.js';
import { CALENDAR_SERVICE } from './calendar.js';
import { NOTION_SERVICE } from './notion.js';

export const SERVICE_REGISTRY: ServiceDefinition[] = [TRELLO_SERVICE, SLACK_SERVICE, GITHUB_SERVICE, SHEETS_SERVICE, CALENDAR_SERVICE, NOTION_SERVICE];

export function getServiceDefinition(id: string): ServiceDefinition | undefined {
  return SERVICE_REGISTRY.find(service => service.id === id);
}
