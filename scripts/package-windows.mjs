import { cp, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const output = resolve(process.env.Z_VIDEO_PACKAGE_DIR ?? join(root, "release", "z-video-win32-x64"));
const dependencyRoots = [join(root, "node_modules"), resolve(root, "..", "..", "node_modules")];
function resolveDependency(name) {
  const relative = name.split("/").join("/");
  const candidate = dependencyRoots.map((dependencyRoot) => join(dependencyRoot, relative)).find((path) => existsSync(join(path, "package.json")));
  if (!candidate) throw new Error(`dependency is unavailable: ${name}`);
  return candidate;
}
const electronSource = resolveDependency("electron");
const runtimeSource = resolve(process.env.Z_VIDEO_ELECTRON_DIST ?? join(electronSource, "dist"));
const koffiSource = resolve(process.env.Z_VIDEO_KOFFI_DIR ?? resolveDependency("koffi"));
const koffiPlatformSource = resolve(process.env.Z_VIDEO_KOFFI_PLATFORM_DIR ?? resolveDependency("@koromix/koffi-win32-x64"));
const xmlParserSource = resolve(process.env.Z_VIDEO_XML_PARSER_DIR ?? resolveDependency("fast-xml-parser"));
const defaultMpvSources = [
  join(root, "vendor", "mpv", "libmpv-2.dll"),
  resolve(root, "..", "..", "vendor", "mpv", "libmpv-2.dll"),
];
const mpvSource = resolve(process.env.Z_VIDEO_MPV_DLL ?? defaultMpvSources.find((candidate) => existsSync(candidate)) ?? defaultMpvSources[0]);
const packageLinkMode = process.env.Z_VIDEO_PACKAGE_LINK_MODE ?? "reuse";
if (packageLinkMode !== "reuse" && packageLinkMode !== "copy") throw new Error(`unsupported Z_VIDEO_PACKAGE_LINK_MODE: ${packageLinkMode}`);
const appRoot = join(output, "resources", "app");
const appNodeModules = join(appRoot, "node_modules");
let reusedFileCount = 0;
let reusedHardLinkCount = 0;
let copiedFileCount = 0;

function requireFile(path, label) {
  if (!path) throw new Error(`${label} is required`);
}

async function assertFile(path, label) {
  requireFile(path, label);
  try {
    const value = await stat(path);
    if (!value.isFile()) throw new Error(`${label} is not a file: ${path}`);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${path} (${error instanceof Error ? error.message : "unknown error"})`);
  }
}

async function copyRuntimeSource(source, target, options = {}) {
  const reuseFiles = options.reuseFiles ?? true;
  const skipNames = options.skipNames ?? new Set();
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyRuntimeSource(sourcePath, targetPath, options);
    } else if (entry.isFile() && !entry.name.endsWith(".map")) {
      await linkOrCopy(sourcePath, targetPath, { reuse: reuseFiles });
    }
  }
}

async function linkOrCopy(source, target, { reuse = true } = {}) {
  await mkdir(dirname(target), { recursive: true });
  if (reuse && packageLinkMode === "reuse") {
    try {
      await link(source, target);
      reusedFileCount += 1;
      reusedHardLinkCount += 1;
      return;
    } catch {
      // Fall through to a regular copy when this filesystem disallows hard links.
    }
  }
  await cp(source, target, { force: true });
  copiedFileCount += 1;
}

async function copyFiles(sourceRoot, targetRoot, paths) {
  for (const path of paths) {
    const source = join(sourceRoot, path);
    const target = join(targetRoot, path);
    await linkOrCopy(source, target);
  }
}

async function collectDependencyClosure(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  const packageRoot = resolveDependency(name);
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) await collectDependencyClosure(dependency, seen);
  return seen;
}

async function copyDependencyClosure(name, targetRoot, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const packageRoot = resolveDependency(name);
  await copyRuntimeSource(packageRoot, join(targetRoot, name));
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) await copyDependencyClosure(dependency, targetRoot, seen);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function treeSize(path) {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await treeSize(child);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      const metadata = await stat(child).catch(() => undefined);
      if (metadata?.isFile()) {
        bytes += metadata.size;
        files += 1;
      }
    }
  }
  return { bytes, files };
}

await assertFile(join(runtimeSource, "electron.exe"), "Electron runtime electron.exe");
await assertFile(join(runtimeSource, "electron_wer.dll"), "Electron runtime electron_wer.dll");
await assertFile(join(runtimeSource, "resources", "default_app.asar"), "Electron runtime default_app.asar");
await assertFile(join(root, "dist", "src", "main", "main.js"), "compiled main entry");
await assertFile(join(root, "dist", "src", "main", "local-library-worker.js"), "compiled local-library utility worker");
await assertFile(join(koffiSource, "package.json"), "Koffi package metadata");
await assertFile(join(koffiSource, "index.cjs"), "Koffi CommonJS entry");
await assertFile(join(koffiSource, "src", "koffi", "index.cjs"), "Koffi runtime loader");
await assertFile(join(koffiSource, "src", "koffi", "src", "static.cjs"), "Koffi static loader");
await assertFile(join(koffiSource, "LICENSE.txt"), "Koffi license");
await assertFile(join(koffiPlatformSource, "package.json"), "Koffi Windows x64 metadata");
await assertFile(join(koffiPlatformSource, "index.js"), "Koffi Windows x64 entry");
await assertFile(join(koffiPlatformSource, "win32_x64", "koffi.node"), "Koffi Windows x64 prebuild");
await assertFile(join(xmlParserSource, "package.json"), "fast-xml-parser package metadata");
await assertFile(join(xmlParserSource, "lib", "fxp.cjs"), "fast-xml-parser CommonJS runtime");
await assertFile(mpvSource, "libmpv-2.dll");

const xmlDependencyClosure = [...await collectDependencyClosure("fast-xml-parser")];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await linkOrCopy(join(runtimeSource, "electron.exe"), join(output, "electron.exe"), { reuse: false });
await copyRuntimeSource(runtimeSource, output, { reuseFiles: true, skipNames: new Set(["electron.exe"]) });
await rename(join(output, "electron.exe"), join(output, "z-video.exe"));
await rename(join(output, "electron_wer.dll"), join(output, "z-video_wer.dll"));

await copyRuntimeSource(join(root, "dist", "src"), join(appRoot, "dist", "src"), { reuseFiles: false });
await mkdir(appNodeModules, { recursive: true });
await copyFiles(koffiSource, join(appNodeModules, "koffi"), [
  "package.json",
  "LICENSE.txt",
  "index.cjs",
  "src/koffi/index.cjs",
  "src/koffi/src/static.cjs",
]);
await copyFiles(koffiPlatformSource, join(appNodeModules, "@koromix", "koffi-win32-x64"), [
  "package.json",
  "index.js",
  "win32_x64/koffi.node",
]);
await copyDependencyClosure("fast-xml-parser", appNodeModules);
await mkdir(join(output, "vendor", "mpv"), { recursive: true });
await linkOrCopy(mpvSource, join(output, "vendor", "mpv", "libmpv-2.dll"));

const appPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  private: true,
  main: "dist/src/main/main.js",
  description: rootPackage.description,
  dependencies: { koffi: rootPackage.dependencies.koffi },
};
await writeFile(join(appRoot, "package.json"), `${JSON.stringify(appPackage, null, 2)}\n`, "utf8");

await copyFiles(runtimeSource, join(output, "licenses"), ["LICENSE", "LICENSES.chromium.html"]);
await copyFiles(koffiSource, join(output, "licenses"), ["LICENSE.txt"]);
const mpvBytes = (await stat(mpvSource)).size;
const mpvHash = await sha256(mpvSource);
const packageSize = await treeSize(output);
const manifest = {
  package: "z-video-win32-x64",
  applicationVersion: rootPackage.version,
  builtAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  runtime: {
    electron: rootPackage.devDependencies.electron,
    executable: "z-video.exe",
    manualDistribution: true,
    licenseFiles: ["licenses/LICENSE", "licenses/LICENSES.chromium.html"],
  },
  native: {
    koffi: rootPackage.dependencies.koffi,
    koffiPlatform: JSON.parse(await readFile(join(koffiPlatformSource, "package.json"), "utf8")).version,
    prebuild: "resources/app/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node",
    libmpv: {
      path: "vendor/mpv/libmpv-2.dll",
      bytes: mpvBytes,
      sha256: mpvHash,
      sourceArchive: "mpv-dev-x86_64-20261016-git-a2cd83c56d.7z",
      sourceUrl: "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261016/mpv-dev-x86_64-20261016-git-a2cd83c56d.7z",
      licenseStatus: "provenance-not-confirmed-for-public-redistribution",
    },
  },
  xml: {
    package: "fast-xml-parser",
    version: rootPackage.dependencies["fast-xml-parser"],
    dependencyClosure: xmlDependencyClosure,
  },
  contents: {
    bytes: packageSize.bytes,
    files: packageSize.files,
    excludes: ["Rust target/source", "tests", "reference", "docs", "TypeScript/compiler", "devDependencies", "source maps"],
  },
  storage: {
    reusedFiles: reusedFileCount,
    copiedFiles: copiedFileCount,
    mode: reusedHardLinkCount > 0 ? "same-volume-hard-link-reuse" : "regular-copies",
    linkPrimitive: reusedHardLinkCount > 0 ? "hard-link" : "none",
    reparseInventory: {
      symbolicLinkFiles: 0,
      junctionDirectories: 0,
      hardLinkedFiles: reusedHardLinkCount,
      regularCopiedFiles: copiedFileCount,
    },
    note: reusedFileCount > 0
      ? "Large Electron/native dependency files use same-volume hard links; the source volume must remain available, but no reparse-point symlinks are created."
      : "All package files are regular copies.",
  },
};
await writeFile(join(output, "package-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(join(output, "README.txt"), [
  "z-video Windows candidate package",
  "",
  "Run z-video.exe from this folder. The first run starts with a fresh profile under %APPDATA%\\z-video.",
  "Use a new --user-data-dir path for isolated smoke tests; do not point it at a normal user profile.",
  "",
  "This package keeps the local-library worker, bundled node:sqlite runtime, fast-xml-parser dependency closure, native libmpv player, and Koffi x64 prebuild in the unpacked app layout.",
  reusedHardLinkCount > 0
    ? `This workspace candidate uses ${reusedHardLinkCount} same-volume hard links for large shared runtime/native files; do not remove the source volume while it is in use.`
    : "All package files are regular copies; this is a personal-use candidate, not a signed or public-distribution release.",
  "The candidate is not signed or ready for public distribution.",
  "See package-manifest.json and licenses/ for exact runtime/native files and provenance limits.",
  "",
].join("\n"), "utf8");

console.log(`PACKAGED: ${output}`);
console.log(`SIZE: ${packageSize.bytes} bytes (${packageSize.files} files)`);
console.log(`MPV: ${mpvBytes} bytes sha256=${mpvHash}`);
