import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDirectory, "..");
const source = join(root, "src", "renderer");
const target = join(root, "dist", "src", "renderer");
await mkdir(target, { recursive: true });
await Promise.all([cp(join(source, "index.html"), join(target, "index.html")), cp(join(source, "styles.css"), join(target, "styles.css"))]);
