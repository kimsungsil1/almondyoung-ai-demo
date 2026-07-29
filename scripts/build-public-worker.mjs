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
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const VOICE_INSTRUCTIONS =
  "한국어 모어민인 유능하고 따뜻한 미용실 AI 실장입니다. 안내방송이나 광고 성우처럼 읽지 말고, 바로 옆에서 원장님께 보고하는 실제 직원처럼 자연스럽게 말하세요. 첫 문장은 편안하고 친근하게, 부족 수량은 또렷하지만 걱정을 과장하지 않게, 마지막 질문은 부담 없이 제안하는 억양으로 마무리하세요. 쉼표에서는 짧게 호흡하고 문장마다 같은 높낮이를 반복하지 마세요. 로봇 같은 박자, 과한 감정, 지나치게 느린 발음은 피하세요.";

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
  async fetch(request, env) {
    const url = new URL(request.url);
    const secretBinding = env.OPENAI_API_KEY;
    const apiKey =
      typeof secretBinding === "string"
        ? secretBinding.trim()
        : typeof secretBinding?.get === "function"
          ? (await secretBinding.get())?.trim()
          : "";
    const voiceConfigured = Boolean(apiKey);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "almondyoung-ai-voice",
        deployment: "cloudflare-workers",
        voiceMode: "gpt-4o-mini-tts",
        voiceConfigured,
      });
    }

    if (url.pathname === "/api/voice" && request.method === "GET") {
      return json({
        configured: voiceConfigured,
        mode: "gpt-4o-mini-tts",
        voice: "marin",
      });
    }

    if (url.pathname === "/api/voice" && request.method === "POST") {
      if (!voiceConfigured) {
        return json(
          { error: "GPT 음성 키가 아직 연결되지 않았습니다." },
          503,
        );
      }

      let input = "";
      try {
        const body = await request.json();
        input = typeof body.text === "string" ? body.text.trim() : "";
      } catch {
        return json({ error: "잘못된 요청입니다." }, 400);
      }

      if (!input || input.length > 700) {
        return json(
          { error: "음성 문장은 1자 이상 700자 이하여야 합니다." },
          400,
        );
      }

      try {
        const response = await fetch(OPENAI_SPEECH_URL, {
          method: "POST",
          headers: {
            Authorization: \`Bearer \${apiKey}\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            voice: "marin",
            input,
            instructions: VOICE_INSTRUCTIONS,
            response_format: "mp3",
            speed: 0.99,
          }),
        });

        if (!response.ok) {
          return json(
            {
              error: "GPT 음성을 생성하지 못했습니다.",
              requestId: response.headers.get("x-request-id") || undefined,
            },
            502,
          );
        }

        return new Response(response.body, {
          headers: {
            "Content-Type":
              response.headers.get("content-type") || "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return json(
          { error: "GPT 음성 서버에 연결하지 못했습니다." },
          502,
        );
      }
    }

    if (url.pathname === "/api/transcribe" && request.method === "POST") {
      if (!voiceConfigured) {
        return json(
          { error: "GPT 음성 키가 아직 연결되지 않았습니다." },
          503,
        );
      }

      let audio = null;
      try {
        const incoming = await request.formData();
        const candidate = incoming.get("audio");
        audio = candidate instanceof File ? candidate : null;
      } catch {
        return json({ error: "음성 파일을 읽지 못했습니다." }, 400);
      }

      if (!audio || audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
        return json(
          { error: "유효한 6MB 이하의 음성 파일이 필요합니다." },
          400,
        );
      }

      const form = new FormData();
      form.append("file", audio, audio.name || "answer.webm");
      form.append("model", "gpt-4o-mini-transcribe");
      form.append("language", "ko");
      form.append("response_format", "json");
      form.append(
        "prompt",
        "미용실 원장님이 자동 주문 제안에 짧게 답합니다. 가능한 답변: 네, 예, 좋아요, 주문해줘, 진행해줘, 아니요, 나중에.",
      );

      try {
        const response = await fetch(OPENAI_TRANSCRIBE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });

        if (!response.ok) {
          return json(
            {
              error: "GPT가 답변을 인식하지 못했습니다.",
              requestId: response.headers.get("x-request-id") || undefined,
            },
            502,
          );
        }

        const result = await response.json();
        return json({
          text: typeof result.text === "string" ? result.text : "",
        });
      } catch {
        return json(
          { error: "GPT 음성 인식 서버에 연결하지 못했습니다." },
          502,
        );
      }
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
