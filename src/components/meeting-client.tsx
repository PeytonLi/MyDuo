"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssistanceRequest, AutoSuggestionState, SessionState, SuggestionDraft } from "@/lib/contracts";
import { Wordmark } from "./wordmark";

type Mode = AssistanceRequest["mode"];

const modeCopy: Record<Mode, string> = {
  answer: "Help me answer",
  support: "Find context",
  clarify: "Suggest a question",
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
  const [draftEdit, setDraftEdit] = useState<{ suggestionId: string; text: string } | null>(null);
  const [reviewedDraft, setReviewedDraft] = useState<{ suggestionId: string; revision: number } | null>(null);
  const [busy, setBusy] = useState<"suggest" | "save" | "speak" | "stop" | "end" | "note" | null>(null);
  const [autoState, setAutoState] = useState<AutoSuggestionState | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [quickNote, setQuickNote] = useState("");
  const [message, setMessage] = useState("");
  const autoAttemptedRevision = useRef(0);

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

  useEffect(() => {
    void api<AutoSuggestionState>(`/api/sessions/${sessionId}/auto-suggestions`)
      .then((state) => {
        autoAttemptedRevision.current = state.lastRevision;
        setAutoState(state);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load automatic suggestions."));
  }, [sessionId]);

  const suggestion = session?.currentSuggestion;
  const draft = draftEdit && draftEdit.suggestionId === suggestion?.id ? draftEdit.text : suggestion?.text ?? "";
  const isStale = Boolean(suggestion && session && suggestion.transcriptRevision < session.transcriptRevision
    && (reviewedDraft?.suggestionId !== suggestion.id || reviewedDraft.revision !== session.transcriptRevision));
  const canSpeak = Boolean(suggestion && session?.mediaReady && draft.trim() && !session.activeSpeech && !isStale);
  const transcript = useMemo(() => session?.recentUtterances ?? [], [session]);

  useEffect(() => {
    const revision = session?.transcriptRevision ?? 0;
    if (!autoState?.enabled || session?.status !== "listening" || revision <= autoAttemptedRevision.current
      || suggestion || session.activeSpeech || draftEdit || busy || autoBusy) return;
    const timer = window.setTimeout(() => {
      autoAttemptedRevision.current = revision;
      setAutoBusy(true);
      void api<{ suggestion: SuggestionDraft | null }>(`/api/sessions/${sessionId}/auto-suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptRevision: revision }),
      }).then(({ suggestion: automatic }) => {
        if (!automatic) return;
        setSession((current) => current && !current.currentSuggestion && current.transcriptRevision === automatic.transcriptRevision
          ? { ...current, currentSuggestion: automatic }
          : current);
      }).catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not create an automatic question.");
      }).finally(() => setAutoBusy(false));
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [autoBusy, autoState?.enabled, busy, draftEdit, session?.activeSpeech, session?.status, session?.transcriptRevision, sessionId, suggestion]);

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
        body: JSON.stringify({ mode, selectedUtteranceIds: selected, transcriptRevision: session.transcriptRevision }),
      });
      setSession((current) => current ? { ...current, currentSuggestion: next } : current);
      setDraftEdit(null);
      setReviewedDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a suggestion.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoSuggestions() {
    if (!autoState) return;
    setAutoBusy(true);
    try {
      const next = await api<AutoSuggestionState>(`/api/sessions/${sessionId}/auto-suggestions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !autoState.enabled }),
      });
      setAutoState(next);
      setMessage(next.enabled ? "Automatic private questions are on." : "Automatic questions paused for this meeting.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update automatic suggestions.");
    } finally {
      setAutoBusy(false);
    }
  }

  async function createPairingCode() {
    setPairingBusy(true);
    try {
      setPairing(await api<{ code: string; expiresAt: string }>("/api/addon/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create a side-panel code.");
    } finally {
      setPairingBusy(false);
    }
  }

  async function saveQuickNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickNote.trim()) return;
    setBusy("note");
    setMessage("");
    try {
      await api(`/api/sessions/${sessionId}/quick-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: quickNote.trim(), selectedUtteranceIds: selected }),
      });
      setQuickNote("");
      setMessage(`Note captured${selected.length ? ` with ${selected.length} selected line${selected.length === 1 ? "" : "s"}` : ""}. Edit it after the meeting.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not capture that note.");
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
      setReviewedDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not dismiss this draft.");
    }
  }

  function reviewStaleDraft() {
    if (!session || !suggestion) return;
    setReviewedDraft({ suggestionId: suggestion.id, revision: session.transcriptRevision });
    setMessage("Draft reviewed against the latest conversation. It is ready to speak.");
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
        <div className={`status status-${session.status}`}><i /> <span>{session.status}</span>{session.status === "waiting" && <small>{session.meetingPlatform === "zoom" ? "MyDuo is in the Zoom waiting room" : "Host may need to admit MyDuo"}</small>}</div>
        <button className="text-button danger" onClick={endSession} disabled={busy === "end" || ["ending", "ended"].includes(session.status)}>{session.status === "ending" ? "Leaving…" : "End session"}</button>
      </header>

      {message && <div className="meeting-notice" role="status">{message}</div>}
      {session.status === "ended" && <div className="meeting-notice"><Link className="button button-accent" href={`/meeting/${sessionId}/review`}>Review meeting memory</Link></div>}

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
          <form className="quick-note-form" onSubmit={saveQuickNote}>
            <label htmlFor="quick-note">Quick note <span className="optional">saved for review after the meeting</span></label>
            <div className="prompt-row">
              <input id="quick-note" value={quickNote} onChange={(event) => setQuickNote(event.target.value)} maxLength={2000} placeholder={selected.length ? `Will attach ${selected.length} selected line${selected.length === 1 ? "" : "s"} as evidence` : "Jot something to remember…"} />
              <button className="button button-ink" disabled={busy === "note" || !quickNote.trim()}>{busy === "note" ? "Saving…" : "Capture"}</button>
            </div>
          </form>
        </section>

        <section className="copilot-panel" aria-labelledby="copilot-heading">
          <div className="meeting-section-head"><div><p className="section-kicker">Private to you</p><h2 id="copilot-heading">Your next contribution</h2></div><span className="privacy-dot" title="Private operator view" /></div>

          <div className="selection-hint">
            <button type="button" className="text-button" aria-pressed={autoState?.enabled ?? false} onClick={toggleAutoSuggestions} disabled={!autoState || autoBusy}>
              {autoState?.enabled ? "Pause automatic questions" : "Auto-suggest questions"}
            </button>
            {autoBusy && <span role="status"> Thinking quietly…</span>}
            <span> · </span>
            <button type="button" className="text-button" onClick={createPairingCode} disabled={pairingBusy}>
              {pairingBusy ? "Creating code…" : "Meet side panel"}
            </button>
            {pairing && <p role="status">Enter <strong>{pairing.code}</strong> in the Meet side panel before {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>}
          </div>

          <form className="assist-form" onSubmit={generate}>
            <div className="mode-switcher" aria-label="Assistance mode">
              {(Object.keys(modeCopy) as Mode[]).map((item) => <button type="button" key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{modeCopy[item]}</button>)}
            </div>
            <div className="prompt-row"><span className="prompt-basis">{selected.length ? `${selected.length} transcript line${selected.length === 1 ? "" : "s"} selected` : "Using the latest conversation"}</span><button className="button button-ink" disabled={busy === "suggest" || autoBusy || session.status !== "listening"}>{busy === "suggest" ? "Thinking…" : "Draft"}</button></div>
          </form>

          {suggestion ? (
            <article className="suggestion-card">
              <div className="suggestion-meta"><span>{suggestion.trigger === "auto" ? "Automatic question" : suggestion.mode}</span><time>{new Date(suggestion.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
              <div className="response-target">
                <p>Responding to{suggestion.responseTargets.length === 0 ? " the latest conversation" : ""}</p>
                {suggestion.responseTargets.map((target) => <blockquote key={target.id}><strong>{target.speakerName}</strong><span>“{target.text}”</span></blockquote>)}
              </div>
              <label htmlFor="draft">Suggested words</label>
              <textarea id="draft" className="draft-text" value={draft} onChange={(event) => setDraftEdit({ suggestionId: suggestion.id, text: event.target.value })} maxLength={600} rows={6} />
              <div className="character-count">{draft.length}/600</div>

              {isStale && <div className="stale-warning" role="alert"><p>The conversation moved on. Review this draft once more before speaking.</p><button className="text-button" type="button" onClick={reviewStaleDraft}>Still relevant — review again</button></div>}

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
            <div className="copilot-empty"><span aria-hidden="true">✦</span><h3>Your draft will appear here</h3><p>Pick a mode, select a transcript line for precision, and let MyDuo combine the meeting with your confirmed notes.</p></div>
          )}

          {session.activeSpeech && <div className="speech-bar"><div><span className="sound-wave small" aria-hidden="true"><i /><i /><i /><i /></span><p><strong>{session.activeSpeech.status}</strong><span>{session.activeSpeech.approvedText}</span></p></div><button className="button button-stop" onClick={stopSpeaking} disabled={busy === "stop"}>{busy === "stop" ? "Stopping…" : "Stop speaking"}</button></div>}
        </section>
      </div>
    </main>
  );
}
