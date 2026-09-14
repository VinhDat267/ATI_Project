import fs from "node:fs";
import path from "node:path";

export type CheckedFilesystemPath = {
  relative: string;
  absolute: string;
  canonicalRoot: string;
  rootId: string;
  rootStat: { dev: number; ino: number };
  expectedReadText?: string;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRelativePath(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/")
  ) {
    throw new Error("BAD_PATH");
  }

  const parts = value.split("/");
  for (const part of parts) {
    if (
      !part ||
      part.startsWith(".") ||
      /[. ]$/.test(part) ||
      !/^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*$/u.test(part) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(
        part.normalize("NFKC")
      )
    ) {
      throw new Error("BAD_PATH");
    }
  }

  return value; // no URL decoding or normalization of approved args
}

export function validateWriteText(content: string): void {
  if (typeof content !== "string") {
    throw new Error("BAD_CONTENT: content must be a string");
  }

  if (content.includes("\u0000")) {
    throw new Error("BAD_CONTENT: content must not contain NUL bytes");
  }

  if (Buffer.byteLength(content, "utf8") > 65536) {
    throw new Error("BAD_CONTENT: content exceeds 65,536 bytes limit");
  }

  if (Buffer.from(content, "utf8").toString("utf8") !== content) {
    throw new Error("BAD_CONTENT: lone surrogates not allowed in text");
  }
}

export async function readBoundedUtf8(absolute: string): Promise<string> {
  const handle = await fs.promises.open(absolute, "r");
  const buffer = Buffer.alloc(65537);
  let bytesRead = 0;

  try {
    while (bytesRead < 65537) {
      const { bytesRead: chunk } = await handle.read(
        buffer,
        bytesRead,
        65537 - bytesRead,
        bytesRead
      );
      if (chunk === 0) {
        break; // EOF reached
      }
      bytesRead += chunk;
    }
  } finally {
    await handle.close();
  }

  if (bytesRead > 65536) {
    throw new Error("PAYLOAD_TOO_LARGE: file exceeds 65,536 bytes limit");
  }

  const fileBytes = buffer.subarray(0, bytesRead);
  if (fileBytes.includes(0x00)) {
    throw new Error("BAD_CONTENT: file contains NUL byte");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let text: string;
  try {
    text = decoder.decode(fileBytes);
  } catch (err: any) {
    throw new Error(`BAD_CONTENT: invalid UTF-8 byte sequence: ${err.message}`);
  }

  if (Buffer.from(text, "utf8").toString("utf8") !== text) {
    throw new Error("BAD_CONTENT: lone surrogate found in file content");
  }

  return text;
}

export async function inspectFilesystemPath(
  root: string,
  relative: string,
  mode: "read" | "write",
  expectedUserId: string
): Promise<CheckedFilesystemPath> {
  const validatedRel = validateRelativePath(relative);

  if (typeof expectedUserId !== "string" || !UUID_REGEX.test(expectedUserId)) {
    throw new Error("UNAUTHORIZED_ROOT_MARKER: invalid expectedUserId UUID format");
  }

  // R1: Check root and all ancestor components for symlinks or junctions
  const absRoot = path.resolve(root);
  const parsedRoot = path.parse(absRoot);
  const relFromDrive = path.relative(parsedRoot.root, absRoot);
  const rootComponents = relFromDrive ? relFromDrive.split(path.sep).filter(Boolean) : [];
  let currentAncestor = parsedRoot.root;

  for (let i = 0; i < rootComponents.length; i++) {
    currentAncestor = path.join(currentAncestor, rootComponents[i]!);
    let st: fs.Stats;
    try {
      st = await fs.promises.lstat(currentAncestor);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`ROOT_NOT_FOUND: component '${rootComponents[i]}' of root does not exist`);
      }
      throw err;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`BAD_ROOT: root component '${rootComponents[i]}' is a symbolic link or junction`);
    }
    if (!st.isDirectory()) {
      throw new Error(`BAD_ROOT: root component '${rootComponents[i]}' is not a directory`);
    }
  }

  const canonicalRoot = await fs.promises.realpath(absRoot);
  const rootStat = await fs.promises.lstat(canonicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("BAD_ROOT: root must be a regular directory");
  }

  // R4: Check root marker .ati-root.json with strict schema and nlink === 1
  const markerPath = path.join(canonicalRoot, ".ati-root.json");
  let markerStat: fs.Stats;
  try {
    markerStat = await fs.promises.lstat(markerPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error("MISSING_ROOT_MARKER: .ati-root.json not found in root");
    }
    throw err;
  }

  if (markerStat.isSymbolicLink()) {
    throw new Error("BAD_ROOT_MARKER: .ati-root.json must not be a symbolic link or junction");
  }
  if (!markerStat.isFile()) {
    throw new Error("BAD_ROOT_MARKER: .ati-root.json must be a regular file");
  }
  if (markerStat.nlink !== 1) {
    throw new Error("HARDLINK_REJECTED: .ati-root.json must not be a hardlink (nlink must be 1)");
  }

  let markerContent: string;
  try {
    markerContent = await fs.promises.readFile(markerPath, "utf8");
  } catch (err: any) {
    throw new Error(`BAD_ROOT_MARKER: failed to read .ati-root.json: ${err.message}`);
  }

  let markerData: any;
  try {
    markerData = JSON.parse(markerContent);
  } catch {
    throw new Error("MALFORMED_ROOT_MARKER: .ati-root.json is not valid JSON");
  }

  if (typeof markerData !== "object" || markerData === null || Array.isArray(markerData)) {
    throw new Error("BAD_ROOT_MARKER: .ati-root.json must be a JSON object");
  }

  const markerKeys = Object.keys(markerData);
  if (
    markerKeys.length !== 3 ||
    !markerKeys.includes("format") ||
    !markerKeys.includes("root_id") ||
    !markerKeys.includes("user_id")
  ) {
    throw new Error("BAD_ROOT_MARKER: .ati-root.json must contain exactly format, root_id, user_id without extra keys");
  }

  if (markerData.format !== "ati-filesystem-root-1") {
    throw new Error("UNAUTHORIZED_ROOT_MARKER: root marker format must be ati-filesystem-root-1");
  }

  if (typeof markerData.root_id !== "string" || !UUID_REGEX.test(markerData.root_id)) {
    throw new Error("UNAUTHORIZED_ROOT_MARKER: root_id must be a valid UUID");
  }

  if (
    typeof markerData.user_id !== "string" ||
    !UUID_REGEX.test(markerData.user_id) ||
    markerData.user_id !== expectedUserId
  ) {
    throw new Error("UNAUTHORIZED_ROOT_MARKER: user_id mismatch or invalid UUID");
  }

  const absoluteTarget = path.resolve(canonicalRoot, validatedRel);

  // Strict containment checks
  const relFromRoot = path.relative(canonicalRoot, absoluteTarget);
  if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
    throw new Error("TRAVERSAL_DETECTED: path escapes root directory");
  }

  const normalizedCanonicalRoot = path.resolve(canonicalRoot) + path.sep;
  if (
    !absoluteTarget.startsWith(normalizedCanonicalRoot) &&
    absoluteTarget !== path.resolve(canonicalRoot)
  ) {
    throw new Error("TRAVERSAL_DETECTED: path escapes canonical root directory");
  }

  // R2: Check all intermediate path components for symlinks or junctions (using lstat, not existsSync)
  const segments = validatedRel.split("/");
  let currentDir = canonicalRoot;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    currentDir = path.join(currentDir, segment);

    let segStat: fs.Stats;
    try {
      segStat = await fs.promises.lstat(currentDir);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`DIRECTORY_NOT_FOUND: component '${segment}' does not exist`);
      }
      throw err;
    }

    if (segStat.isSymbolicLink()) {
      throw new Error(`SYMLINK_REJECTED: component '${segment}' is a symbolic link or junction`);
    }
    if (!segStat.isDirectory()) {
      throw new Error(`NOT_A_DIRECTORY: component '${segment}' is not a directory`);
    }
  }

  // R2: Check leaf target using lstat directly
  let leafStat: fs.Stats | null = null;
  try {
    leafStat = await fs.promises.lstat(absoluteTarget);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      leafStat = null;
    } else {
      throw err;
    }
  }

  if (leafStat !== null) {
    if (leafStat.isSymbolicLink()) {
      throw new Error("SYMLINK_REJECTED: target is a symbolic link or junction");
    }
    if (!leafStat.isFile()) {
      throw new Error("NOT_REGULAR_FILE: target must be a regular file");
    }
    if (leafStat.nlink > 1) {
      throw new Error("HARDLINK_REJECTED: target file has nlink > 1");
    }
  }

  if (mode === "read") {
    if (leafStat === null) {
      throw new Error("FILE_NOT_FOUND: target file does not exist");
    }

    const text = await readBoundedUtf8(absoluteTarget);

    const statAfter = await fs.promises.lstat(absoluteTarget);
    if (statAfter.isSymbolicLink()) {
      throw new Error("SYMLINK_REJECTED: target file modified to symbolic link during inspection");
    }
    if (statAfter.nlink > 1) {
      throw new Error("HARDLINK_REJECTED: target file modified to hardlink during inspection");
    }

    return {
      relative: validatedRel,
      absolute: absoluteTarget,
      canonicalRoot,
      rootId: markerData.root_id,
      rootStat: { dev: rootStat.dev, ino: rootStat.ino },
      expectedReadText: text,
    };
  } else {
    // Mode write
    const parentDir = path.dirname(absoluteTarget);
    let parentStat: fs.Stats;
    try {
      parentStat = await fs.promises.lstat(parentDir);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error("PARENT_NOT_FOUND: parent directory does not exist");
      }
      throw err;
    }

    if (parentStat.isSymbolicLink()) {
      throw new Error("PARENT_NOT_DIRECTORY: parent directory is a symbolic link or junction");
    }
    if (!parentStat.isDirectory()) {
      throw new Error("PARENT_NOT_DIRECTORY: parent must be a regular directory");
    }

    if (leafStat === null) {
      // Leaf does not exist: check for NFC/NFD alias conflict in parent directory
      const leafName = path.basename(absoluteTarget);
      const leafNfc = leafName.normalize("NFC");
      const entries = await fs.promises.readdir(parentDir);
      for (const entry of entries) {
        if (entry !== leafName && entry.normalize("NFC") === leafNfc) {
          throw new Error(
            "UNICODE_ALIAS_CONFLICT: existing entry with different spelling but same NFC normalization"
          );
        }
      }
    }

    return {
      relative: validatedRel,
      absolute: absoluteTarget,
      canonicalRoot,
      rootId: markerData.root_id,
      rootStat: { dev: rootStat.dev, ino: rootStat.ino },
    };
  }
}
