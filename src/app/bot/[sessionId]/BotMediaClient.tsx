"use client";

import { useEffect, useRef, useState } from "react";
import type { SpeechState } from "@/lib/contracts";

type CommandPoll = { stopRevision: number; command: SpeechState | null };
type PendingAcknowledgement = { commandId: string; status: "playing" | "completed" | "failed" };

export default function BotMediaClient({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState("Connecting securely…");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const stopRevisionRef = useRef(0);
  const processingRef = useRef<string | null>(null);
  const pendingAcknowledgementRef = useRef<PendingAcknowledgement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const storageKey = `myduo-media-${sessionId}`;

    const clearAudio = () => {
      audioAbortRef.current?.abort();
      audioAbortRef.current = null;
      audioRef.current?.pause();
      audioRef.current = null;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      processingRef.current = null;
    };

    const acknowledge = async (token: string, commandId: string, speechStatus: "playing" | "completed" | "failed") => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(`/api/media/${sessionId}/commands`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ commandId, status: speechStatus }),
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
        await acknowledge(token, pending.commandId, pending.status);
        if (pendingAcknowledgementRef.current === pending) pendingAcknowledgementRef.current = null;
        return true;
      } catch {
        return false;
      }
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
        const url = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        audioAbortRef.current = null;
        const audio = new Audio(url);
        audioUrlRef.current = url;
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
        await audio.play();
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
        const pending = pendingAcknowledgementRef.current;
        if (pending && !await persistAcknowledgement(token, pending)) {
          setStatus("Reconnecting playback state…");
        }
        if (data.command && !processingRef.current) {
          void play(token, data.command);
        } else if (!audioRef.current) {
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
