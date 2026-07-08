import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const forbiddenBrowserMpstatsImports = [
  "src/lib/mpstats/requestCore",
  "src/lib/mpstats/client",
  "src/lib/mpstats/sellerReport",
  "src/lib/mpstats/sellerResolve"
];

test("MPStats request core is imported only by server-side code or CLI diagnostics", () => {
  const imports = findTextMatches(["src", "scripts", "tests"], /from ["']([^"']+)["']/g)
    .filter((match) => isSensitiveMpstatsImport(match.file, match.value));

  assert.deepEqual(imports.map((match) => `${match.file}:${match.value}`).sort(), [
    "scripts/mpstats-debug-warehouse-geography.ts:../src/lib/mpstats/requestCore.ts",
    "scripts/mpstats-support-diagnostics.ts:../src/lib/mpstats/requestCore.ts",
    "scripts/mpstats-warehouse-discrepancy-diagnostics.ts:../src/lib/mpstats/requestCore.ts",
    "src/app/api/mpstats/seller/resolve/route.ts:../../../../../lib/mpstats/sellerResolve",
    "src/app/api/mpstats/seller/run/route.ts:../../../../../lib/mpstats/sellerReport",
    "src/lib/mpstats/client.ts:./requestCore",
    "src/lib/mpstats/sellerReport.ts:./client",
    "src/lib/mpstats/sellerReport.ts:./sellerResolve",
    "src/lib/mpstats/sellerResolve.ts:./client"
  ]);
});

test("browser-facing code does not import MPStats token-backed modules or call mpstats.io", () => {
  const browserFiles = listSourceFiles("src")
    .filter((file) => file.startsWith("src/components/") || (file.startsWith("src/app/") && !file.startsWith("src/app/api/")))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

  const violations: string[] = [];
  for (const file of browserFiles) {
    const source = readProjectFile(file);
    for (const forbiddenImport of forbiddenBrowserMpstatsImports) {
      if (source.includes(forbiddenImport) || source.includes(forbiddenImport.replace("src/", "../"))) {
        violations.push(`${file} imports ${forbiddenImport}`);
      }
    }
    if (/https:\/\/mpstats\.io|mpstats\.io\/api/i.test(source)) {
      violations.push(`${file} references mpstats.io directly`);
    }
  }

  assert.deepEqual(violations, []);
});

test("MPStats seller page is isolated from calculator UI and uses internal API route", () => {
  const pageSource = readProjectFile("src/app/mpstats/page.tsx");
  const clientSource = readProjectFile("src/components/mpstats/MpstatsSellerPage.tsx");
  const searchSource = readProjectFile("src/components/mpstats/MpstatsSellerSearch.tsx");

  assert.equal(pageSource.includes("CalculatorApp"), false);
  assert.equal(clientSource.includes("\"/api/mpstats/seller/run\""), true);
  assert.equal(/https:\/\/mpstats\.io|mpstats\.io\/api/i.test(clientSource), false);
  assert.equal(searchSource.includes("<form"), false);
  assert.match(searchSource, /type="button"/);
});

test("MPStats secret env names are restricted to server-side or diagnostic files", () => {
  const matches = findTextMatches(["src", "scripts"], /MPSTATS_TOKEN|NEXT_PUBLIC_MPSTATS_TOKEN|VITE_MPSTATS_TOKEN/g);
  const violations = matches
    .filter((match) => match.value === "NEXT_PUBLIC_MPSTATS_TOKEN" || match.value === "VITE_MPSTATS_TOKEN")
    .filter((match) => !match.file.startsWith("docs/"));

  assert.deepEqual(violations, []);

  const tokenFiles = [...new Set(matches.filter((match) => match.value === "MPSTATS_TOKEN").map((match) => match.file))].sort();
  assert.deepEqual(tokenFiles, [
    "scripts/mpstats-debug-warehouse-geography.ts",
    "scripts/mpstats-support-diagnostics.ts",
    "scripts/mpstats-warehouse-discrepancy-diagnostics.ts",
    "src/app/api/mpstats/route.ts",
    "src/lib/mpstats/requestCore.ts"
  ]);
});

function findTextMatches(dirs: string[], pattern: RegExp) {
  return dirs.flatMap((dir) => listSourceFiles(dir))
    .flatMap((file) => {
      const source = readProjectFile(file);
      return [...source.matchAll(pattern)].map((match) => ({
        file,
        value: match[1] ?? match[0]
      }));
    });
}

function isSensitiveMpstatsImport(file: string, specifier: string) {
  if (specifier.includes("requestCore")) return true;
  if (/(^|\/|\.)sellerReport(\.ts)?$/.test(specifier)) return true;
  if (/(^|\/|\.)sellerResolve(\.ts)?$/.test(specifier)) return true;
  if (specifier.includes("mpstats/client")) return true;
  return file.startsWith("src/lib/mpstats/") && specifier === "./client";
}

function listSourceFiles(dir: string): string[] {
  const absoluteDir = join(projectRoot, dir);
  const result: string[] = [];

  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const absolutePath = join(current, entry);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(absolutePath);
        continue;
      }

      if (!/\.(ts|tsx|js|jsx|md)$/.test(entry)) continue;
      result.push(relative(projectRoot, absolutePath).split(sep).join("/"));
    }
  }

  walk(absoluteDir);
  return result.sort();
}

function readProjectFile(file: string) {
  return readFileSync(join(projectRoot, file), "utf-8");
}
