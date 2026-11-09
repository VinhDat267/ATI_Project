export declare const WS_ALPHA_UUID: string;
export declare const WS_BETA_UUID: string;
export declare const USER_ALPHA_UUID: string;
export declare const USER_BETA_UUID: string;
export declare function redactDatabaseUrl(connectionString: string): string;
export declare function assertEphemeralTestDbIdentifier(dbName: string): string;
export declare function assertDedicatedTestDatabaseUrl(
  connectionString: string,
  options?: { role?: 'adminUrl' | 'testDbUrl' },
): { host: string; port: string; dbName: string; redactedUrl: string };
export declare function run0034MigrationVerification(options?: {
  adminUrl?: string;
  testDbUrl?: string;
}): Promise<any>;
