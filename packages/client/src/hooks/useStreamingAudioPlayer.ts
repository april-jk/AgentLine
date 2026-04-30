import { useCallback, useEffect, useRef } from "react";

function base64ToBytes(input: string): Uint8Array {
  return Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export interface StreamingAudioPlayer {
  start: (contentType: string) => Promise<void>;
  appendBase64Chunk: (audioBase64: string) => void;
  finish: () => Promise<void>;
  stop: () => void;
}

export function useStreamingAudioPlayer(): StreamingAudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const contentTypeRef = useRef("audio/mpeg");
  const chunksRef = useRef<Uint8Array[]>([]);
  const preparedRef = useRef(false);
  const playbackDoneRef = useRef<Promise<void> | null>(null);
  const playbackDoneResolveRef = useRef<(() => void) | null>(null);

  const resetPlaybackPromise = useCallback(() => {
    playbackDoneRef.current = new Promise<void>((resolve) => {
      playbackDoneResolveRef.current = resolve;
    });
  }, []);

  const resolvePlayback = useCallback(() => {
    playbackDoneResolveRef.current?.();
    playbackDoneResolveRef.current = null;
  }, []);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) {
      return audioRef.current;
    }
    const audio = new Audio();
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.onended = () => resolvePlayback();
    audio.onerror = () => resolvePlayback();
    audioRef.current = audio;
    return audio;
  }, [resolvePlayback]);

  const stop = useCallback(() => {
    sourceNodeRef.current?.stop();
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    chunksRef.current = [];
    preparedRef.current = false;
    resolvePlayback();
  }, [resolvePlayback]);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (contentType: string) => {
      contentTypeRef.current = contentType;
      if (
        typeof window !== "undefined" &&
        typeof window.AudioContext === "function" &&
        !audioContextRef.current
      ) {
        audioContextRef.current = new window.AudioContext();
      }
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume().catch(() => undefined);
      }
      const audio = ensureAudio();
      if (!preparedRef.current) {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        audio.pause();
        audio.currentTime = 0;
        audio.src = "";
        chunksRef.current = [];
        resetPlaybackPromise();
        preparedRef.current = true;
      }
    },
    [ensureAudio, resetPlaybackPromise],
  );

  const appendBase64Chunk = useCallback((audioBase64: string) => {
    chunksRef.current.push(base64ToBytes(audioBase64));
  }, []);

  const finish = useCallback(async () => {
    const audio = ensureAudio();
    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      resolvePlayback();
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    const mergedAudio = new Blob(
      chunks.map((chunk) => toArrayBuffer(chunk)),
      {
        type: contentTypeRef.current,
      },
    );
    chunksRef.current = [];

    let played = false;
    const context = audioContextRef.current;
    if (context) {
      try {
        if (context.state === "suspended") {
          await context.resume();
        }
        const decoded = await context.decodeAudioData(
          await mergedAudio.arrayBuffer(),
        );
        const sourceNode = context.createBufferSource();
        sourceNode.buffer = decoded;
        sourceNode.connect(context.destination);
        sourceNode.onended = () => {
          resolvePlayback();
          sourceNodeRef.current = null;
        };
        sourceNodeRef.current = sourceNode;
        sourceNode.start();
        played = true;
      } catch {
        sourceNodeRef.current?.disconnect();
        sourceNodeRef.current = null;
      }
    }

    if (!played) {
      const url = URL.createObjectURL(mergedAudio);
      objectUrlRef.current = url;
      audio.src = url;
      await audio.play().catch(() => undefined);
    }
    await (playbackDoneRef.current ?? Promise.resolve());
    preparedRef.current = false;
    playbackDoneRef.current = null;
  }, [ensureAudio, resolvePlayback]);

  return {
    start,
    appendBase64Chunk,
    finish,
    stop,
  };
}
