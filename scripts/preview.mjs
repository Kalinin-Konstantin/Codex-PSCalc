import { spawn } from "node:child_process";

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`));
    });
  });

async function updateWbTariffs() {
  try {
    await run("node", ["scripts/import_wb_tariffs.mjs"]);
  } catch (error) {
    console.warn("");
    console.warn("WB tariffs were not updated. Starting preview with the latest local tariff files.");
    console.warn(error.message);
    console.warn("");
  }
}

await updateWbTariffs();
await run("node", ["scripts/build_preview_data.mjs"]);

const server = spawn("node", ["scripts/serve_preview.mjs"], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.kill(signal);
  });
}

server.once("exit", (code) => {
  process.exit(code ?? 0);
});
