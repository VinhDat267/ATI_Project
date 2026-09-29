#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'apps', 'chat-web');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const webPort = process.env.V3_WEB_PORT || '5174';
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

function start(label, args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`[v3] ${label}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[v3] ${label} stopped (exit ${code ?? 'signal'}).`);
      stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log(`[v3] Starting API on port ${process.env.PORT || '3000'} and web on port ${webPort}.`);
start('API', ['--import', 'tsx', 'apps/chat-api/src/server.ts'], root);
start('web', [viteCli, '--host', '127.0.0.1', '--port', webPort, '--strictPort'], webRoot);
