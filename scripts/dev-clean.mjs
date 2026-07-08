#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const NEXT_DIR = path.join(PROJECT_ROOT, ".next");
const DEV_PORT = "3000";
const SHUTDOWN_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 150;

function run(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return "";
  }
}

function readProcesses() {
  return run("ps", ["-axo", "pid=,ppid=,command="])
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3]
    }));
}

function isNextDevCommand(command) {
  return (
    /(^|\s)next(?:-server)?\s+dev(?:\s|$)/i.test(command)
    || /next[\/\\]dist[\/\\]bin[\/\\]next(?:['"])?\s+dev(?:\s|$)/i.test(command)
    || /npm\s+(?:run|run-script)\s+dev(?:\s|$)/i.test(command)
  );
}

function listeningPids(port) {
  return run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"])
    .split("\n")
    .filter((line) => line.startsWith("p"))
    .map((line) => Number(line.slice(1)))
    .filter(Number.isFinite);
}

function collectDescendants(processes, rootPids) {
  const childrenByParent = new Map();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? [];
    children.push(processInfo.pid);
    childrenByParent.set(processInfo.ppid, children);
  }

  const result = new Set(rootPids);
  const queue = [...rootPids];
  while (queue.length) {
    const pid = queue.shift();
    for (const childPid of childrenByParent.get(pid) ?? []) {
      if (!result.has(childPid)) {
        result.add(childPid);
        queue.push(childPid);
      }
    }
  }

  return result;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminateProcesses(pids) {
  const candidates = [...pids]
    .filter((pid) => pid !== process.pid && pid !== process.ppid && isAlive(pid))
    .sort((left, right) => right - left);

  if (!candidates.length) {
    console.log("No running Next.js dev server found.");
    return;
  }

  console.log(`Stopping Next.js dev server process(es): ${candidates.join(", ")}`);
  for (const pid of candidates) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < SHUTDOWN_TIMEOUT_MS) {
    if (candidates.every((pid) => !isAlive(pid))) return;
    await sleep(POLL_INTERVAL_MS);
  }

  const stillAlive = candidates.filter(isAlive);
  if (stillAlive.length) {
    console.warn(`Process(es) did not stop after SIGTERM, forcing shutdown: ${stillAlive.join(", ")}`);
    for (const pid of stillAlive) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  }
}

async function main() {
  const processes = readProcesses();
  const nextDevRootPids = processes
    .filter((processInfo) => isNextDevCommand(processInfo.command))
    .map((processInfo) => processInfo.pid);

  const port3000NextPids = listeningPids(DEV_PORT)
    .filter((pid) => {
      const processInfo = processes.find((candidate) => candidate.pid === pid);
      return processInfo ? isNextDevCommand(processInfo.command) || /next/i.test(processInfo.command) : false;
    });

  const pidsToStop = collectDescendants(processes, [...nextDevRootPids, ...port3000NextPids]);
  await terminateProcesses(pidsToStop);

  if (existsSync(NEXT_DIR)) {
    console.log("Removing .next cache/build artifacts...");
    rmSync(NEXT_DIR, { recursive: true, force: true });
  }

  console.log(`Starting Next.js dev server on http://localhost:${DEV_PORT}`);
  const nextBin = path.join(PROJECT_ROOT, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  const child = spawn(nextBin, ["dev", "--port", DEV_PORT], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
