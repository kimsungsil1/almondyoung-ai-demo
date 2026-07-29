import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const distDir = resolve(projectRoot, "cloudflare-dist");
const outputPath = resolve(
  process.argv[2] ?? join(projectRoot, "..", "public-worker.mjs"),
);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

async function walk(directory) {
  const items = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) items.push(...(await walk(path)));
    else items.push(path);
  }
  return items;
}

const assets = {};
for (const path of await walk(distDir)) {
  const pathname = `/${relative(distDir, path).split(sep).join("/")}`;
  assets[pathname] = {
    body: (await readFile(path)).toString("base64"),
    type: mimeTypes[extname(path)] ?? "application/octet-stream",
  };
}

const workerSource = `
const ASSETS = ${JSON.stringify(assets)};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "almondyoung-ai-voice",
        deployment: "cloudflare-workers",
        voiceMode: "browser",
      });
    }

    if (url.pathname === "/api/voice" && request.method === "GET") {
      return json({ configured: false, mode: "browser" });
    }

    if (url.pathname === "/api/voice" || url.pathname === "/api/transcribe") {
      return json(
        { error: "공개판은 브라우저 음성 기능을 사용합니다." },
        503,
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "지원하지 않는 요청입니다." }, 405);
    }

    const asset =
      ASSETS[url.pathname] ||
      (url.pathname.endsWith("/") ? ASSETS[\`\${url.pathname}index.html\`] : null) ||
      ASSETS["/index.html"];
    if (!asset) return new Response("Not found", { status: 404 });

    const headers = new Headers({
      "Content-Type": asset.type,
      "Cache-Control":
        asset.type.startsWith("text/html")
          ? "public, max-age=0, must-revalidate"
          : "public, max-age=31536000, immutable",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
    return new Response(
      request.method === "HEAD" ? null : decodeBase64(asset.body),
      { headers },
    );
  },
};
`.trimStart();

await writeFile(outputPath, workerSource, "utf8");
console.log(`Built public Worker bundle (${Buffer.byteLength(workerSource)} bytes).`);
