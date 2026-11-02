export class WorkspaceRepoError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message?: string) {
    super(message || code);
    this.name = 'WorkspaceRepoError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, WorkspaceRepoError.prototype);
  }
}
