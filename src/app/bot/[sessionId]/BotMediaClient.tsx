"use client";

import { useEffect, useRef, useState } from "react";
import type { SpeechState } from "@/lib/contracts";

type CommandPoll = {
  stopRevision: number;
  command: SpeechState | null;
  floor: { humanSpeaking: boolean; quietSince: string | null };
};
type PendingAcknowledgement = {
  commandId: string;
  status: "playing" | "completed" | "cancelled" | "failed";
  errorCode?: string;
};

const FLOOR_SILENCE_MS = 900;

export default function BotMediaClient({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState("Connecting securely…");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const stopRevisionRef = useRef(0);
  const processingRef = useRef<string | null>(null);
  const waitingCommandRef = useRef<SpeechState | null>(null);
  const pendingAcknowledgementRef = useRef<PendingAcknowledgement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const storageKey = `myduo-media-${sessionId}`;

    const clearAudio = () => {
      audioAbortRef.current?.abort();
      audioAbortRef.current = null;
      if (audioRef.current) {
        audioRef.current.onplaying = null;
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      audioRef.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      processingRef.current = null;
      waitingCommandRef.current = null;
    };

    const acknowledge = async (token: string, pending: PendingAcknowledgement) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(`/api/media/${sessionId}/commands`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(pending),
          });
          if (response.ok) return;
        } catch {
          // Retry brief Output Media network interruptions below.
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
      throw new Error("Playback state could not be saved");
    };

    const persistAcknowledgement = async (token: string, pending: PendingAcknowledgement) => {
      pendingAcknowledgementRef.current = pending;
      try {
        await acknowledge(token, pending);
        if (pendingAcknowledgementRef.current === pending) pendingAcknowledgementRef.current = null;
        return true;
      } catch {
        return false;
      }
    };

    const appendChunk = (source: SourceBuffer, chunk: Uint8Array) => new Promise<void>((resolve, reject) => {
      const done = () => {
        source.removeEventListener("updateend", done);
        source.removeEventListener("error", failed);
        resolve();
      };
      const failed = () => {
        source.removeEventListener("updateend", done);
        source.removeEventListener("error", failed);
        reject(new Error("Audio stream failed"));
      };
      source.addEventListener("updateend", done, { once: true });
      source.addEventListener("error", failed, { once: true });
      source.appendBuffer(chunk.slice().buffer);
    });

    const streamIntoAudio = async (response: Response, audio: HTMLAudioElement, controller: AbortController) => {
      if (!response.body || !MediaSource.isTypeSupported("audio/mpeg")) {
        const url = URL.createObjectURL(await response.blob());
        audioUrlRef.current = url;
        audio.src = url;
        await audio.play();
        return;
      }

      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      audioUrlRef.current = url;
      audio.src = url;
      await new Promise<void>((resolve, reject) => {
        const opened = () => {
          controller.signal.removeEventListener("abort", aborted);
          resolve();
        };
        const aborted = () => {
          mediaSource.removeEventListener("sourceopen", opened);
          reject(new DOMException("Aborted", "AbortError"));
        };
        mediaSource.addEventListener("sourceopen", opened, { once: true });
        controller.signal.addEventListener("abort", aborted, { once: true });
      });

      const source = mediaSource.addSourceBuffer("audio/mpeg");
      const reader = response.body.getReader();
      controller.signal.addEventListener("abort", () => void reader.cancel(), { once: true });
      let playback: Promise<void> | null = null;
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        await appendChunk(source, value);
        playback ??= audio.play();
      }
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (mediaSource.readyState === "open") mediaSource.endOfStream();
      if (!playback) throw new Error("Audio stream was empty");
      await playback;
    };

    const play = async (token: string, command: SpeechState) => {
      processingRef.current = command.id;
      setStatus("Preparing approved response…");
      const controller = new AbortController();
      audioAbortRef.current = controller;
      try {
        const response = await fetch(`/api/media/${sessionId}/audio/${command.id}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Audio unavailable");
        audioAbortRef.current = null;
        const audio = new Audio();
        audioRef.current = audio;
        audio.onplaying = () => {
          setStatus("Speaking approved response");
          void persistAcknowledgement(token, { commandId: command.id, status: "playing" })
            .then((saved) => { if (!saved) setStatus("Speaking — reconnecting state…"); });
        };
        audio.onended = () => {
          setStatus("Listening");
          void persistAcknowledgement(token, { commandId: command.id, status: "completed" })
            .then((saved) => { if (!saved) setStatus("Playback ended — reconnecting state…"); })
            .finally(clearAudio);
        };
        audio.onerror = () => {
          setStatus("Playback needs attention");
          void persistAcknowledgement(token, { commandId: command.id, status: "failed" }).finally(clearAudio);
        };
        audioAbortRef.current = controller;
        await streamIntoAudio(response, audio, controller);
      } catch {
        if (controller.signal.aborted) return;
        setStatus("Playback needs attention");
        await persistAcknowledgement(token, { commandId: command.id, status: "failed" });
        clearAudio();
      }
    };

    const poll = async (token: string) => {
      try {
        const response = await fetch(`/api/media/${sessionId}/commands`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Media session expired");
        const data = (await response.json()) as CommandPoll;
        if (data.stopRevision > stopRevisionRef.current) {
          stopRevisionRef.current = data.stopRevision;
          clearAudio();
          setStatus("Stopped — listening");
        }
        if (data.floor.humanSpeaking && processingRef.current) {
          const commandId = processingRef.current;
          clearAudio();
          setStatus("Paused for a participant — response cancelled");
          await persistAcknowledgement(token, { commandId, status: "cancelled", errorCode: "HUMAN_SPEECH" });
        }
        const pending = pendingAcknowledgementRef.current;
        if (pending && !await persistAcknowledgement(token, pending)) {
          setStatus("Reconnecting playback state…");
        }
        if (data.command) waitingCommandRef.current = data.command;
        const quietSince = data.floor.quietSince ? Date.parse(data.floor.quietSince) : 0;
        const floorIsClear = !data.floor.humanSpeaking && (!quietSince || Date.now() - quietSince >= FLOOR_SILENCE_MS);
        if (waitingCommandRef.current && !processingRef.current && floorIsClear) {
          const command = waitingCommandRef.current;
          waitingCommandRef.current = null;
          void play(token, command);
        } else if (waitingCommandRef.current) {
          setStatus("Waiting for a clear moment…");
        } else if (!processingRef.current && !audioRef.current) {
          setStatus("Listening");
        }
      } catch {
        if (!cancelled) setStatus("Connection interrupted");
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(token), 500);
      }
    };

    const connect = async () => {
      const fragment = new URLSearchParams(location.hash.slice(1));
      const bootstrap = fragment.get("bootstrap");
      if (bootstrap) history.replaceState(null, "", location.pathname + location.search);
      let token = sessionStorage.getItem(storageKey);
      if (!token && bootstrap) {
        const response = await fetch("/api/media/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, token: bootstrap }),
        });
        if (!response.ok) throw new Error("Media link expired");
        token = String((await response.json()).token);
        sessionStorage.setItem(storageKey, token);
      }
      if (!token) throw new Error("Media authorization missing");
      await poll(token);
    };

    void connect().catch(() => setStatus("Unable to connect"));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearAudio();
    };
  }, [sessionId]);

  return <p role="status">{status}</p>;
}
