export const dynamic = "force-dynamic";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

function getApiKey() {
  return process.env.OPENAI_API_KEY?.trim();
}

export async function GET() {
  return Response.json(
    { configured: Boolean(getApiKey()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "GPT 음성 키가 아직 연결되지 않았습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let input = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    input = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!input || input.length > 700) {
    return Response.json(
      { error: "음성 문장은 1자 이상 700자 이하여야 합니다." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "marin",
        input,
        response_format: "mp3",
        speed: 0.99,
        instructions:
          "한국어 원어민인 유능하고 따뜻한 미용실 AI 실장입니다. 안내방송이나 광고 성우처럼 읽지 말고, 바로 옆에서 원장님께 보고하는 실제 직원처럼 자연스럽게 말하세요. 첫 문장은 편안하고 친근하게, 부족 수량은 또렷하지만 걱정을 과장하지 않게, 마지막 질문은 부담 없이 살짝 억양을 올리세요. 쉼표에서는 짧게 호흡하고 문장마다 같은 높낮이를 반복하지 마세요. 로봇 같은 박자, 과한 감정, 지나치게 느린 발음은 피하세요.",
      }),
    });

    if (!response.ok) {
      const requestId = response.headers.get("x-request-id");
      return Response.json(
        {
          error: "GPT 음성을 생성하지 못했습니다.",
          requestId: requestId ?? undefined,
        },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "GPT 음성 서버에 연결하지 못했습니다." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
