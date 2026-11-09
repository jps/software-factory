import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist");
const bundleDir = resolve(distDir, "bundle");
const outFile = resolve(bundleDir, "index.mjs");
const zipFile = resolve(distDir, "tools.zip");

mkdirSync(bundleDir, { recursive: true });

await build({
  entryPoints: [resolve(__dirname, "../src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: outFile,
  sourcemap: true,
  external: ["@aws-sdk/*"],
});

execFileSync("zip", ["-j", "-q", zipFile, outFile, `${outFile}.map`]);
console.log(`Bundled AgentCore Tool artifact: ${zipFile}`);
