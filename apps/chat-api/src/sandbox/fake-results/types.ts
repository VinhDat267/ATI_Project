export type FakeResult = (args: Record<string, any>, scenario?: string) => unknown;
export interface FakeService { id: string; tools: Record<string, FakeResult> }
