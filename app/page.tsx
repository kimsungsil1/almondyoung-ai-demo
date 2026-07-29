"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const analysisLines = [
  "내일 예약 일정을 확인하고 있습니다.",
  "총 12건의 예약을 확인했습니다.",
  "시술별 예상 재료 사용량을 계산하고 있습니다.",
  "현재 미용실 재고와 비교하고 있습니다.",
];

const processLines = [
  "예약에 맞는 최적 상품을 선택하고 있습니다.",
  "거래처 재고를 확인하고 있습니다.",
  "최적 가격을 비교하고 있습니다.",
  "배송 가능 시간을 확인하고 있습니다.",
  "자동 주문을 처리하고 있습니다.",
];

const proposalVoice =
  "원장님, 내일 염색 예약이 일곱 건인데요. 지금 재고로는 염색약 네 개와 산화제 두 개가 부족할 것 같아요. 필요한 제품, 제가 미리 주문해 둘까요?";

const completeVoice =
  "네, 주문이 완료됐습니다. 제품은 내일 오전 아홉 시 전, 아몬드영 특급배송으로 도착할 예정이에요.";

type SpeechResultLike = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => RecognitionLike;
type MicPermissionState = "unknown" | "prompt" | "granted" | "denied";

const steps = ["예약 분석", "부족 예측", "AI 제안", "자동 주문", "주문 완료"];

function Icon({
  name,
  className = "",
}: {
  name: "reset" | "sound" | "fullscreen" | "mic" | "check" | "spark";
  className?: string;
}) {
  const paths = {
    reset: <><path d="M4 7v5h5" /><path d="M5.6 16.5a8 8 0 1 0 .2-9.2L4 12" /></>,
    sound: <><path d="M5 9v6h4l5 4V5L9 9H5Z" /><path d="M17 9.2a4 4 0 0 1 0 5.6" /><path d="M19.5 6.5a8 8 0 0 1 0 11" /></>,
    fullscreen: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    check: <path d="m6 12 4 4 8-9" />,
    spark: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="3.5" /></>,
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const [step, setStep] = useState(0);
  const [analysisIndex, setAnalysisIndex] = useState(0);
  const [bookingCount, setBookingCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [processIndex, setProcessIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("질문이 끝나면 자동으로 듣습니다.");
  const [autoplay, setAutoplay] = useState(false);
  const [toast, setToast] = useState("");
  const [gptVoiceReady, setGptVoiceReady] = useState<boolean | null>(null);
  const [micPermission, setMicPermission] =
    useState<MicPermissionState>("unknown");

  const stepRef = useRef(0);
  const mutedRef = useRef(false);
  const gptVoiceReadyRef = useRef<boolean | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenRunRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const voiceAbortRef = useRef<AbortController | null>(null);
  const voiceRunRef = useRef(0);
  const rafRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvingRef = useRef(false);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/voice", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { configured?: unknown }) => {
        const ready = data.configured === true;
        gptVoiceReadyRef.current = ready;
        setGptVoiceReady(ready);
      })
      .catch(() => {
        gptVoiceReadyRef.current = false;
        setGptVoiceReady(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.permissions?.query
    ) {
      return;
    }

    let active = true;
    let permissionStatus: PermissionStatus | null = null;
    const syncPermission = async () => {
      try {
        permissionStatus = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        if (!active) return;
        setMicPermission(permissionStatus.state as MicPermissionState);
        if (permissionStatus.state === "denied") {
          setVoiceStatus(
            "마이크가 차단되어 있습니다. 주소창의 사이트 설정에서 허용해 주세요.",
          );
        }
        permissionStatus.onchange = () => {
          if (!active || !permissionStatus) return;
          setMicPermission(permissionStatus.state as MicPermissionState);
          if (permissionStatus.state === "granted") {
            setVoiceStatus("마이크 권한이 허용되었습니다. 다시 말하기를 눌러 주세요.");
          } else if (permissionStatus.state === "denied") {
            setVoiceStatus(
              "마이크가 차단되어 있습니다. 주소창의 사이트 설정에서 허용해 주세요.",
            );
          }
        };
      } catch {
        // 일부 브라우저는 마이크 권한 조회를 지원하지 않습니다.
      }
    };

    const handleFocus = () => {
      void syncPermission();
    };
    void syncPermission();
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", handleFocus);
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2100);
  }, []);

  const stopVoice = useCallback(() => {
    voiceRunRef.current += 1;
    voiceAbortRef.current?.abort();
    voiceAbortRef.current = null;

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // 음성 기능 실패는 시연 흐름을 막지 않습니다.
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    listenRunRef.current += 1;
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // 이미 종료된 녹음기는 무시합니다.
      }
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    const current = recognitionRef.current;
    recognitionRef.current = null;
    if (current) {
      current.onend = null;
      current.onerror = null;
      current.onresult = null;
      try {
        current.abort();
      } catch {
        // 이미 종료된 인식기는 무시합니다.
      }
    }
    setListening(false);
  }, []);

  const chooseNaturalKoreanVoice = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices().filter((voice) =>
      voice.lang.toLowerCase().startsWith("ko"),
    );
    if (!voices.length) return null;

    return [...voices].sort((a, b) => {
      const score = (voice: SpeechSynthesisVoice) => {
        const name = voice.name.toLowerCase();
        let value = 0;
        if (name.includes("natural")) value += 120;
        if (name.includes("neural")) value += 110;
        if (name.includes("online")) value += 80;
        if (/injun|injoon|sunhi|heami|korean|한국/.test(name)) value += 70;
        if (name.includes("microsoft")) value += 45;
        if (name.includes("google")) value += 40;
        if (voice.localService) value += 10;
        if (voice.default) value += 5;
        return value;
      };
      return score(b) - score(a);
    })[0];
  }, []);

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      stopVoice();
      const runId = voiceRunRef.current;
      let finished = false;
      const finish = () => {
        if (finished || runId !== voiceRunRef.current) return;
        finished = true;
        onEnd?.();
      };

      const browserFallback = () => {
        if (
          runId !== voiceRunRef.current ||
          mutedRef.current ||
          typeof window === "undefined" ||
          !("speechSynthesis" in window)
        ) {
          setTimeout(finish, 350);
          return;
        }

        try {
          const utterance = new SpeechSynthesisUtterance(text);
          const voice = chooseNaturalKoreanVoice();
          if (voice) utterance.voice = voice;
          utterance.lang = "ko-KR";
          utterance.rate = 0.89;
          utterance.pitch = 0.98;
          utterance.volume = 1;
          utterance.onend = finish;
          utterance.onerror = finish;
          window.speechSynthesis.speak(utterance);
        } catch {
          setTimeout(finish, 350);
        }
      };

      if (mutedRef.current || typeof window === "undefined") {
        setTimeout(finish, 450);
        return;
      }

      if (gptVoiceReadyRef.current === false) {
        browserFallback();
        return;
      }

      const controller = new AbortController();
      voiceAbortRef.current = controller;
      fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            if (response.status === 503) {
              gptVoiceReadyRef.current = false;
              setGptVoiceReady(false);
            }
            throw new Error("GPT voice unavailable");
          }
          return response.blob();
        })
        .then((blob) => {
          if (runId !== voiceRunRef.current || mutedRef.current) return;
          const objectUrl = URL.createObjectURL(blob);
          audioUrlRef.current = objectUrl;
          const audio = new Audio(objectUrl);
          audioRef.current = audio;
          audio.preload = "auto";
          audio.onended = () => {
            if (audioRef.current === audio) audioRef.current = null;
            URL.revokeObjectURL(objectUrl);
            if (audioUrlRef.current === objectUrl) audioUrlRef.current = "";
            finish();
          };
          audio.onerror = () => {
            if (audioRef.current === audio) audioRef.current = null;
            URL.revokeObjectURL(objectUrl);
            if (audioUrlRef.current === objectUrl) audioUrlRef.current = "";
            browserFallback();
          };
          return audio.play().catch(() => {
            audio.pause();
            audioRef.current = null;
            URL.revokeObjectURL(objectUrl);
            if (audioUrlRef.current === objectUrl) audioUrlRef.current = "";
            browserFallback();
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          browserFallback();
        });
    },
    [chooseNaturalKoreanVoice, stopVoice],
  );

  const approveOrder = useCallback(() => {
    if (stepRef.current !== 3 || approvingRef.current) return;
    approvingRef.current = true;
    stopListening();
    stopVoice();
    setVoiceStatus("승인을 확인했습니다.");
    setProgress(0);
    setProcessIndex(0);
    setStep(4);
  }, [stopListening, stopVoice]);

  const startDemo = useCallback(() => {
    approvingRef.current = false;
    setAnalysisIndex(0);
    setBookingCount(0);
    setProgress(0);
    setProcessIndex(0);
    setHeard("");
    setStep(1);
  }, []);

  const acceptTranscript = useCallback(
    (transcript: string) => {
      const clean = transcript.trim();
      const normalized = clean.replace(/[\s.,!?~]/g, "");
      const rejected = /(아니|안돼|하지마|나중|취소)/.test(normalized);
      const approved =
        !rejected &&
        /^(네|내|예|응|어|좋아|좋아요|그래|진행해|주문해|주문해줘|해주세요)/.test(
          normalized,
        );

      setHeard(clean);
      setListening(false);
      if (approved) {
        setVoiceStatus(`“${clean || "네"}”라고 답하셨습니다. 주문을 진행합니다.`);
        setTimeout(approveOrder, 520);
      } else {
        setVoiceStatus(
          clean
            ? `“${clean}”으로 들었습니다. “네”라고 다시 말씀해 주세요.`
            : "답변을 듣지 못했습니다. “네”라고 다시 말씀해 주세요.",
        );
      }
    },
    [approveOrder],
  );

  const startBrowserListening = useCallback(() => {
    const browserWindow = window as typeof window & {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Recognition =
      browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;

    if (!Recognition) {
 #m{��h��춻�q�^w�'VffW"�'�FT�V�wF��v�&�W%6�W&6R��'�FW2����