"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AssistanceRequest, SessionState, SuggestionDraft } from "@/lib/contracts";
import { Wordmark } from "./wordmark";

type Mode = AssistanceRequest["mode"];

const modeCopy: Record<Mode, { label: string; prompt: string }> = {
  answer: { label: "Help me answer", prompt: "What do you want help answering?" },
  support: { label: "Find context", prompt: "What detail should MyDuo look for?" },
  clarify: { label: "Suggest a question", prompt: "What feels unclear?" },
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body as T;
}

function formatOffset(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MeetingClient({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("answer");
  const [question, setQuestion] = useState("");
  const [draftEdit, setDraftEdit] = useState<{ suggestionId: string; text: string } | null>(null);
  const [busy, setBusy] = useState<"suggest" | "save" | "speak" | "stop" | "end" | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api<SessionState>(`/api/sessions/${sessionId}`);
      setSession((current) => {
        const currentSuggestion = current?.currentSuggestion;
        if (currentSuggestion && next.currentSuggestion && currentSuggestion.version > next.currentSuggestion.version) {
          return { ...next, currentSuggestion };
        }
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection interrupted.");
    }
  }, [sessionId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const suggestion = session?.currentSuggestion;
  const draft = draftEdit && draftEdit.suggestionId === suggestion?.id ? draftEdit.text : suggestion?.text ?? "";
  const isStale = Boolean(suggestion && session && suggestion.transcriptRevision < session.transcriptRevision);
  const canSpeak = Boolean(suggestion && session?.mediaReady && draft.trim() && !session.activeSpeech && !isStale);
  const transcript = useMemo(() => session?.recentUtterances ?? [], [session]);

  function toggleUtterance(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current.slice(-9), id]);
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy("suggest");
    setMessage("");
    try {
      const next = await api<SuggestionDraft>(`/api/sessions/${sessionId}/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, selectedUtteranceIds: selected, operatorQuestion: question || undefined, transcriptRevision: session.transcriptRevision }),
      });
      setSession((current) => current ? { ...current, currentSuggestion: next } : current);
      setDraftEdit(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a suggestion.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!suggestion || draft.trim() === suggestion.text) return;
    setBusy("save");
    try {
      const next = await api<SuggestionDraft>(`/api/suggestions/${suggestion.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: draft, version: suggestion.version }),
      });
      setSession((current) => current ? { ...current, currentSuggestion: next } : current);
      setDraftEdit(null);
      setMessage("Edit saved as a new version.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the edit.");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    if (!suggestion) return;
    try {
      await api(`/api/suggestions/${suggestion.id}`, { method: "DELETE" });
      setSession((current) => current ? { ...current, currentSuggestion: null } : current);
      setDraftEdit(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not dismiss this draft.");
    }
  }

  async function speak() {
    if (!session || !suggestion || !canSpeak) return;
    setBusy("speak");
    setMessage("");
    try {
      await api(`/api/sessions/${sessionId}/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionId: suggestion.id, version: suggestion.version, approvedText: draft.trim(), clientRequestId: crypto.randomUUID(), reviewedTranscriptRevision: session.transcriptRevision }),
      });
      setMessage("Approved. Preparing MyDuo’s voice…");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send that to the meeting.");
    } finally {
      setBusy(null);
    }
  }

  async function stopSpeaking() {
    setBusy("stop");
    try {
      await api(`/api/sessions/${sessionId}/speech`, { method: "DELETE" });
      setMessage("Stop requested.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop speaking.");
    } finally {
      setBusy(null);
    }
  }

  async function endSession() {
    setBusy("end");
    try {
      await api(`/api/sessions/${sessionId}`, { method: "DELETE" });
      setMessage("Leave requested. Waiting for confirmation…");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not end the session.");
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return <main className="center-stage"><p className="eyebrow">Connecting to your meeting…</p>{message && <p role="alert">{message}</p>}</main>;
  }

  return (
    <main className="meeting-shell">
      <header className="meeting-topbar">
        <Wordmark compact />
        <div className={`status status-${session.status}`}><i /> <span>{session.status}</span>{session.status === "waiting" && <small>Host may need to admit MyDuo</small>}</div>
        <button className="text-button danger" onClick={endSession} disabled={busy === "end" || ["ending", "ended"].includes(session.status)}>{session.status === "ending" ? "Leaving…" : "End session"}</button>
      </header>

      {message && <div className="meeting-notice" role="status">{message}</div>}

      <div className="meeting-grid">
        <section className="transcript-panel" aria-labelledby="transcript-heading">
          <div className="meeting-section-head"><div><p className="section-kicker">Live room</p><h1 id="transcript-heading">Transcript</h1></div><span className="revision">rev {session.transcriptRevision}</span></div>
          <p className="selection-hint">Select a line to give MyDuo a precise starting point.</p>
          <div className="transcript-list" aria-live="polite">
            {transcript.length === 0 ? <div className="empty-state"><span className="sound-wave" aria-hidden="true"><i /><i /><i /><i /></span><h2>Listening for the first words</h2><p>Committed transcript lines will appear here.</p></div> : transcript.map((turn) => (
              <button type="button" className={`utterance ${selected.includes(turn.id) ? "selected" : ""}`} key={turn.id} onClick={() => toggleUtterance(turn.id)} aria-pressed={selected.includes(turn.id)}>
                <span className="speaker-line"><strong>{turn.speakerName}</strong><time>{formatOffset(turn.startMs)}</time></span>
                <span>{turn.text}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="copilot-panel" aria-labelledby="copilot-heading">
          <div className="meeting-section-head"><div><p className="section-kicker">Private to you</p><h2 id="copilot-heading">Your next contribution</h2></div><span className="privacy-dot" title="Private operator view" /></div>

          <form className="assist-form" onSubmit={generate}>
            <div className="mode-switcher" aria-label="Assistance mode">
              {(Object.keys(modeCopy) as Mode[]).map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{modeCopy[item].label}</button>)}
            </div>
            <label htmlFor="question">{modeCopy[mode].prompt}</label>
            <div className="prompt-row"><input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} placeholder={selected.length ? `${selected.length} transcript line${selected.length === 1 ? "" : "s"} selected` : "Use the latest conversation"} /><button className="button button-ink" disabled={busy === "suggest" || session.status !== "listening"}>{busy === "suggest" ? "Thinking…" : "Draft"}</button></div>
          </form>

          {suggestion ? (
            <article className="suggestion-card">
              <div className="suggestion-meta"><span>{suggestion.mode}</span><time>{new Date(suggestion.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
              <label htmlFor="draft">Suggested words</label>
              <textarea id="draft" className="draft-text" value={draft} onChange={(event) => setDraftEdit({ suggestionId: suggestion.id, text: event.target.value })} maxLength={600} rows={6} />
              <div className="character-count">{draft.length}/600</div>

              {isStale && <p className="stale-warning" role="alert">The conversation moved on. Create a fresh draft before speaking.</p>}

              <div className="evidence-block">
                <p className="evidence-label">{suggestion.basis === "needs_context" ? "Needs more context" : suggestion.basis === "meeting" ? "Based on this meeting" : suggestion.basis === "notes" ? "Supported by your notes" : "Supported by notes and meeting"}</p>
                {suggestion.evidence.map((item) => <details key={item.id}><summary>{item.title}</summary><p>“{item.excerpt}”</p>{item.occurredAt && <time>{new Date(item.occurredAt).toLocaleDateString()}</time>}</details>)}
              </div>

              <div className="suggestion-actions">
                <button className="button button-accent" onClick={speak} disabled={!canSpeak || busy !== null}>{busy === "speak" ? "Preparing…" : session.mediaReady ? "Speak to meeting" : "Waiting for audio"}</button>
                <button className="button button-quiet" onClick={saveEdit} disabled={draft.trim() === suggestion.text || !draft.trim() || busy !== null}>{busy === "save" ? "Saving…" : "Save edit"}</button>
                <button className="text-button" onClick={dismiss}>Dismiss</button>
              </div>
            </article>
          ) : (
            <div className="copilot-empty"><span aria-hidden="true">✦</span><h3>Your draft will appear here</h3><p>Pick a mode, add a thought if useful, and let MyDuo combine it with the meeting and your confirmed notes.</p></div>
          )}

          {session.activeSpeech && <div className="speech-bar"><div><span className="sound-wave small" aria-hidden="true"><i /><i /><i /><i /></span><p><strong>{session.activeSpeech.status}</strong><span>{session.activeSpeech.approvedText}</span></p></div><button className="button button-stop" onClick={stopSpeaking} disabled={busy === "stop"}>{busy === "stop" ? "Stopping…" : "Stop speaking"}</button></div>}
        </section>
      </div>
    </main>
  );
}
