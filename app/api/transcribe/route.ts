export const dynamic = "force-dynamic";

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "GPT 음성 키가 아직 연결되지 않았습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let audio: File | null = null;
  try {
    const incoming = await request.formData();
    const candidate = incoming.get("audio");
    audio = candidate instanceof File ? candidate : null;
  } catch {
    return Response.json({ error: "음성 파일을 읽지 못했습니다." }, { status: 400 });
  }

  if (!audio || audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: "유효한 6MB 이하의 음성 파일이 필요합니다." },
      { status: 400 },
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
      const requestId = response.headers.get("x-request-id");
      return Response.json(
        {
          error: "GPT가 답변을 인식하지 못했습니다.",
          requestId: requestId ?? undefined,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = (await response.json()) as { text?: unknown };
    return Response.json(
      { text: typeof result.text === "string" ? result.text : "" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "GPT 음성 인식 서버에 연결하지 못했습니다." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
