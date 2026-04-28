import { useCallback, useEffect, useRef, useState } from "react";

export interface SpeakOptions {
  lang?: string;
  pitch?: number;
  rate?: number;
  volume?: number;
  voiceName?: string;
}

export interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  error: string | null;
  speak: (text: string, options?: SpeakOptions) => Promise<boolean>;
  stop: () => void;
}

function getSpeechSynthesisApi(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }
  return window.speechSynthesis;
}

function getSpeechUtteranceConstructor():
  | typeof SpeechSynthesisUtterance
  | null {
  if (
    typeof window === "undefined" ||
    !("SpeechSynthesisUtterance" in window)
  ) {
    return null;
  }
  return window.SpeechSynthesisUtterance;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSupported] = useState(
    () => !!getSpeechSynthesisApi() && !!getSpeechUtteranceConstructor(),
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingResolveRef = useRef<((completed: boolean) => void) | null>(null);

  const stop = useCallback(() => {
    const synthesis = getSpeechSynthesisApi();
    if (!synthesis) return;

    synthesis.cancel();
    setIsSpeaking(false);
    if (pendingResolveRef.current) {
      pendingResolveRef.current(false);
      pendingResolveRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const speak = useCallback(
    async (text: string, options: SpeakOptions = {}): Promise<boolean> => {
      const synthesis = getSpeechSynthesisApi();
      const Utterance = getSpeechUtteranceConstructor();
      const normalizedText = text.trim();

      if (!normalizedText) {
        return false;
      }

      if (!synthesis || !Utterance) {
        setError("Speech synthesis not supported");
        return false;
      }

      stop();
      setError(null);
      setIsSpeaking(true);

      return new Promise<boolean>((resolve) => {
        pendingResolveRef.current = resolve;

        const utterance = new Utterance(normalizedText);
        utterance.lang = options.lang ?? "zh-CN";
        utterance.pitch = options.pitch ?? 1;
        utterance.rate = options.rate ?? 1;
        utterance.volume = options.volume ?? 1;

        if (options.voiceName) {
          const voice = synthesis
            .getVoices()
            .find((candidate) => candidate.name === options.voiceName);
          if (voice) {
            utterance.voice = voice;
          }
        }

        utterance.onend = () => {
          setIsSpeaking(false);
          pendingResolveRef.current?.(true);
          pendingResolveRef.current = null;
        };

        utterance.onerror = () => {
          setIsSpeaking(false);
          setError("Speech synthesis failed");
          pendingResolveRef.current?.(false);
          pendingResolveRef.current = null;
        };

        synthesis.speak(utterance);
      });
    },
    [stop],
  );

  return {
    isSupported,
    isSpeaking,
    error,
    speak,
    stop,
  };
}
