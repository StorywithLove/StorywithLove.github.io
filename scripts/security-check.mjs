import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ignored = new Set([".git", "node_modules", ".vite", "coverage"]);
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".html", ".css", ".env"]);
const findings = [];

const rules = [
  ["private key material", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["database connection URI", /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/i],
  ["credential-like assignment", /(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/i],
  ["local absolute path", /(?:[A-Za-z]:[\\/](?:Users|lib|home)[\\/]|\/(?:Users|home)\/)/],
  ["SSH private configuration", /(?:IdentityFile|HostName)\s+[^\s]+/i],
];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    const rel = relative(root, fullPath).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (/^\.env(?:\.|$)/.test(entry.name) && entry.name !== ".env.example") {
      findings.push({ file: rel, category: "committed environment file" });
    }
    if (!extensions.has(extname(entry.name)) && entry.name !== ".env.example") continue;
    if (entry.name === "package-lock.json") continue;
    const content = await readFile(fullPath, "utf8");
    for (const [category, pattern] of rules) {
      if (pattern.test(content)) findings.push({ file: rel, category });
    }
  }
}

await walk(root);

const browserFiles = [
  "src/services/dataAdapter.ts",
  "src/services/powerAdapter.ts",
  "src/services/weatherAdapter.ts",
  "src/components/SiteMap.tsx",
  "src/agent/apiClient.ts",
];
const allowedHosts = new Set([
  "api.xn--fhq9f80kj05g.com",
  "solarcentre.spinifexvalley.com.au",
  "api.open-meteo.com",
  "tile.openstreetmap.org",
  "{s}.tile.openstreetmap.org",
  "server.arcgisonline.com",
  "www.openstreetmap.org",
  "www.esri.com",
]);
for (const file of browserFiles) {
  const content = await readFile(resolve(root, file), "utf8");
  for (const match of content.matchAll(/https:\/\/([^/"'`]+)/g)) {
    if (!allowedHosts.has(match[1])) findings.push({ file, category: "unexpected browser request host" });
  }
}

if (findings.length) {
  console.error("Security check failed. Values are intentionally not printed.");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.category}`);
  process.exitCode = 1;
} else {
  console.log("Security check passed: no credential, private-key, connection-URI, SSH, or local-path risks detected.");
  console.log("Browser request hosts match the documented public allowlist.");
}
