import { execFileSync } from "node:child_process";

/** Reads actual Git state. Unit integration tests substitute only this observation. */
export function observeGitEvidence(cwd: string): { head: string; clean: boolean } {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  return { head: git("rev-parse", "HEAD"), clean: git("status", "--porcelain=v1", "-uall") === "" };
}
