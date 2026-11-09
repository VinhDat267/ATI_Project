declare module '@wap/chat-api/*' {
  const mod: Record<string, any>;
  export default mod;
  export const createAuthMiddleware: any;
  export const generateAccessToken: any;
  export const createWorkspaceContextMiddleware: any;
  export const createScheduleRoutes: any;
  export const isSchedulePath: any;
  export const createConversationRoutes: any;
  export const userFacingError: any;
  export const MessageRepo: any;
  export const UserRepo: any;
  export const computeSheetsDigestV1Hash: any;
  export const SHEETS_DELIVERY_UNKNOWN: string;
  export const ScheduleService: any;
  export const DIGEST_TEST_ENC_KEY: string;
  export const PERSONAL_A_SPREADSHEET_ID: string;
  export const insertTestSheetsDigestSchedule: any;
  export const seedSheetsDigestTenants: any;
}

declare module '@wap/planner-schedule-occurrence' {
  export const localLabel: any;
  export const nextOccurrence: any;
  export const nextRuns: any;
}
