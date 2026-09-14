import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const rootArg = process.argv.indexOf("--project-root");
const projectRoot = path.resolve(
  rootArg >= 0 ? process.argv[rootArg + 1] ?? process.cwd() : process.cwd(),
);
const userId = process.env.G1_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuid.test(userId)) throw Error("CONFIG: G1_USER_ID must be a UUID");

const parent = path.join(projectRoot, "runtime", "filesystem");
const allowedRoot = path.join(parent, userId);
const markerPath = path.join(allowedRoot, ".ati-root.json");
const notesPath = path.join(allowedRoot, "notes.txt");
const ensureRegularDirectory = (value, label) => {
  if (fs.existsSync(value)) {
    const stat = fs.lstatSync(value);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error(`CONFIG: ${label} is not a regular directory`);
  } else fs.mkdirSync(value);
};

ensureRegularDirectory(path.join(projectRoot, "runtime"), "runtime");
ensureRegularDirectory(parent, "runtime/filesystem");
ensureRegularDirectory(allowedRoot, "filesystem principal root");
ensureRegularDirectory(path.join(allowedRoot, "reports"), "reports");

const marker = { format: "ati-filesystem-root-1", root_id: crypto.randomUUID(), user_id: userId };
if (fs.existsSync(markerPath)) {
  const existing = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const keys = Object.keys(existing).sort();
  if (
    keys.join(",") !== "format,root_id,user_id" ||
    existing.format !== marker.format ||
    existing.user_id !== userId ||
    !uuid.test(existing.root_id)
  ) throw Error("CONFIG: existing .ati-root.json is invalid or owned by another principal");
} else {
  fs.writeFileSync(markerPath, JSON.stringify(marker) + "\n", { flag: "wx" });
}
if (!fs.existsSync(notesPath))
  fs.writeFileSync(notesPath, "Tiến độ ATI\nAPI: Done\n", { flag: "wx" });

console.log(JSON.stringify({ presetId: "filesystem-local-v1", userId, allowedRoot, marker: markerPath, notes: notesPath }, null, 2));
