// Compatibility entry point; auth features live in dedicated routers.
export { createAuthRoutes, DEMO_ADMIN_ID } from './auth/index.js';
export type { AuthRoutesOptions } from './auth/index.js';
