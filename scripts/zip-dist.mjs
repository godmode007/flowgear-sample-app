/**
 * Flowgear expects ZIP entries at archive root (e.g. app.json).
 * Windows `tar` / `Compress-Archive` often emit `./`-prefixed paths; archiver does not.
 */
import archiver from "archiver";
import { createWriteStream, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Keep app.json Version in sync with package.json version automatically
const pkgJson  = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appJson  = JSON.parse(readFileSync(join(root, "public", "app.json"), "utf8"));
const name     = appJson.Name;
const version  = pkgJson.version;   // single source of truth

if (!name || typeof name !== "string") {
  throw new Error("public/app.json missing Name");
}
if (!version || typeof version !== "string") {
  throw new Error("package.json missing version");
}

// Patch app.json in dist so the deployed file matches
import { writeFileSync } from "node:fs";
const distAppJsonPath = join(root, "dist", "app.json");
const distAppJson = JSON.parse(readFileSync(distAppJsonPath, "utf8"));
distAppJson.Version = version;
writeFileSync(distAppJsonPath, JSON.stringify(distAppJson, null, 2) + "\n", "utf8");
console.log(`Patched dist/app.json Version → ${version}`);
const outName = `${name}-${version}.zip`;
const outPath = join(root, outName);
const distDir = join(root, "dist");

const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on("close", resolve);
  output.on("error", reject);
  archive.on("error", reject);
  archive.on("warning", (err) => {
    if (err.code !== "ENOENT") reject(err);
  });
  archive.pipe(output);
  archive.directory(distDir, false);
  archive.finalize();
});

console.log(`Wrote ${outName} (${archive.pointer()} bytes)`);
