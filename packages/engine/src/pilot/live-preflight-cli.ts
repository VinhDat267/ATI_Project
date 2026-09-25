import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  runPilotLivePreflight,
  type PreflightCheckResult,
} from "./live-preflight.js";

type Emit = (line: string) => void;

/** An explicit read-only operator entry point. It never selects a sample row. */
export async function runPreflightCli(
  args: readonly string[],
  emit: Emit = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Promise<number> {
  const values = new Map<string, string>();
  let invalid = args.length % 2 !== 0;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (
      !flag ||
      !["--principal", "--request-id", "--output"].includes(flag) ||
      !value?.trim() ||
      values.has(flag)
    ) {
      invalid = true;
      break;
    }
    values.set(flag, value.trim());
  }
  const output = values.get("--output");
  let result: PreflightCheckResult | undefined;
  if (
    invalid ||
    !values.get("--principal") ||
    !values.get("--request-id") ||
    !output
  ) {
    result = await blockedResult(
      "CLI_ARGUMENT_ERROR: --principal, --request-id and --output are required; no other flags are accepted",
    );
  } else {
    let evidenceFile;
    let commit: string | undefined;
    let workingTreeDirty: boolean | undefined;
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Invalid commit");
      workingTreeDirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
    } catch {
      result = await blockedResult("COMMIT_UNAVAILABLE: Could not bind evidence to Git HEAD");
    }
    try {
      if (result) throw new Error("Commit unavailable");
      // Reserve the evidence path before any network read. Existing files are
      // never replaced, and an invalid path cannot produce an unrecorded run.
      evidenceFile = await open(output, "wx");
    } catch {
      result ??= await blockedResult("OUTPUT_ERROR: Could not create the requested evidence file");
    }
    if (evidenceFile) {
      try {
        result = await runPilotLivePreflight({
          principalId: values.get("--principal"),
          testRequestId: values.get("--request-id"),
          commit,
          workingTreeDirty,
        });
        await evidenceFile.writeFile(`${JSON.stringify(result, null, 2)}\n`, {
          encoding: "utf8",
        });
        await evidenceFile.close();
      } catch {
        await evidenceFile.close().catch(() => {});
        result = await blockedResult(
          "OUTPUT_ERROR: Could not finish the requested evidence file",
        );
      }
    }
  }
  result ??= await blockedResult("OUTPUT_ERROR: Preflight result was not recorded");
  emit(JSON.stringify(result));
  return result.status === "passed" &&
    result.checks.sheetsRead.status === "pass" &&
    result.checks.trelloRead.status === "pass"
    ? 0
    : 1;
}

async function blockedResult(message: string): Promise<PreflightCheckResult> {
  const result = await runPilotLivePreflight({
    config: { enabled: false },
    principalId: "",
    testRequestId: "",
  });
  result.errors = [message];
  return result;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runPreflightCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.stderr.write("Preflight could not complete\n");
      process.exitCode = 1;
    },
  );
}
