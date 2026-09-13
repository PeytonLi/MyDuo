"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { meet } from "@googleworkspace/meet-addons/meet.addons";
import type { AssistanceRequest, SessionState, SuggestionDraft } from "@/lib/contracts";
import { Wordmark } from "@/components/wordmark";
import styles from "./meet-addon.module.css";

type Mode = AssistanceRequest["mode"];

async function api<T>(url: string, token: string | null, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "MyDuo could not complete that request.");
  return body as T;
}

export function MeetAddonClient({ cloudProjectNumber }: { cloudProjectNumber: string }) {
  const [sdkState, setSdkState] = useState<"loading" | "ready" | "outside" | "unconfigured">(cloudProjectNumber ? "loading" : "unconfigured");
  const [token, setToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [mode, setMode] = useState<Mode>("clarify");
  const [draftEdit, setDraftEdit] = useState<{ suggestionId: string; text: string } | null>(null);
  const [quickNote, setQuickNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloudProjectNumber) {
      return;
    }
    meet.addon.createAddonSession({ cloudProjectNumber })
      .then((addonSession) => addonSession.createSidePanelClient())
      .then(() => setSdkState("ready"))
      .catch(() => setSdkState("outside"));
  }, [cloudProjectNumber]);

  const refresh = useCallback(async () => {
    if (!token || !sessionId) return;
    try {
      const next = await api<SessionState>(`/api/sessions/${sessionId}`, token);
      setSession(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection interrupted.");
    }
  }, [sessionId, token]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = new FormData(event.currentTarget);
      const paired = await api<{ token: string; sessionId: string }>("/api/addon/exchange", null, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.get("code") }),
      });
      setToken(paired.token);
      setSessionId(paired.sessionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!token || !sessionId || !session) return;
    setBusy(true);
    setMessage("");
    try {
      const suggestion = await api<SuggestionDraft>(`/api/sessions/${sessionId}/suggestions`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, selectedUtteranceIds: [], transcriptRevision: session.transcriptRevision }),
      });
      setSession({ ...session, currentSuggestion: suggestion });
      setDraftEdit(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Drafting failed.");
    } finally {
      setBusy(false);
    }
  }

  async function captureNote(event: FormEvent) {
    event.preventDefault();
    if (!token || !sessionId || !quickNote.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/sessions/${sessionId}/quick-notes`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: quickNote.trim(), selectedUtteranceIds: [] }),
      });
      setQuickNote("");
      setMessage("Note captured. Edit it after the meeting.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not capture that note.");
    } finally {
      setBusy(false);
    }
  }

  async function speak() {
    const suggestion = session?.currentSuggestion;
    if (!token || !sessionId || !session || !suggestion || !draft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}/speech`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          version: suggestion.version,
          approvedText: draft.trim(),
          clientRequestId: crypto.randomUUID(),
          reviewedTranscriptRevision: session.transcriptRevision,
        }),
      });
      setMessage("Approved for the meeting.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speech approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!token || !sessionId) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}/speech`, token, { method: "DELETE" });
      setMessage("Stop requested.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function endMeeting() {
    if (!token || !sessionId) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}`, token, { method: "DELETE" });
      setSession(null);
      setSessionId(null);
      setToken(null);
      setMessage("Meeting ended.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to end the meeting.");
    } finally {
      setBusy(false);
    }
  }

  if (!token || !sessionId) {
    return (
      <section className={styles.pairing}>
        <Wordmark compact />
        <p className={styles.eyebrow}>Private Meet panel</p>
        <h1>Pair with your active session</h1>
        <p>Create a pairing code in the MyDuo meeting window, then enter it here. The code works once and expires after five minutes.</p>
        <form onSubmit={pair}>
          <label htmlFor="pair-code">Pairing code</label>
          <input id="pair-code" name="code" inputMode="text" autoComplete="one-time-code" pattern="[A-Fa-f0-9]{10}" maxLength={10} required />
          <button disabled={busy}>{busy ? "Pairing…" : "Pair panel"}</button>
        </form>
        {sdkState === "unconfigured" && <p role="status">Add the Google Cloud project number before installing this panel in Meet.</p>}
        {sdkState === "outside" && <p role="status">Open this page from the MyDuo activity inside Google Meet.</p>}
        {message && <p role="alert">{message}</p>}
      </section>
    );
  }

  if (!session) return <p className={styles.loading}>Connecting to MyDuo…</p>;

  const suggestion = session.currentSuggestion;
  const draft = draftEdit && draftEdit.suggestionId === suggestion?.id ? draftEdit.text : suggestion?.text ?? "";
  const stale = Boolean(suggestion && suggestion.transcriptRevision < session.transcriptRevision);
  return (
    <section className={styles.panel}>
      <header><Wordmark compact /><span>{session.status}</span></header>
      {message && <p className={styles.notice} role="status">{message}</p>}
      <div className={styles.transcript} aria-live="polite">
        {session.recentUtterances.slice(-8).map((turn) => <p key={turn.id}><strong>{turn.speakerName}</strong>{turn.text}</p>)}
      </div>
      <form onSubmit={captureNote} className={styles.noteForm}>
        <label htmlFor="addon-note">Quick note <span>saved for review after the meeting</span></label>
        <input id="addon-note" value={quickNote} onChange={(event) => setQuickNote(event.target.value)} maxLength={2000} placeholder="Jot something to remember…" />
        <button disabled={busy || !quickNote.trim()}>{busy ? "Saving…" : "Capture"}</button>
      </form>
      <form onSubmit={generate} className={styles.composer}>
        <label htmlFor="addon-mode">Help me</label>
        <select id="addon-mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
          <option value="answer">Answer</option><option value="support">Find context</option><option value="clarify">Ask a question</option>
        </select>
        <button disabled={busy || session.status !== "listening"}>{busy ? "Working…" : "Draft privately"}</button>
      </form>
      {suggestion && <div className={styles.draft}>
        <label htmlFor="addon-draft">Suggested words</label>
        <textarea id="addon-draft" value={draft} onChange={(event) => setDraftEdit({ suggestionId: suggestion.id, text: event.target.value })} maxLength={600} rows={6} />
        {stale && <p role="alert">The meeting changed. Draft again before speaking.</p>}
        <div><button onClick={speak} disabled={busy || stale || !session.mediaReady || !draft.trim()}>Speak to meeting</button><button className={styles.stop} onClick={stop} disabled={busy || !session.activeSpeech}>Stop</button></div>
      </div>}
      <button className={styles.end} onClick={endMeeting} disabled={busy}>End meeting</button>
      <small>Only you can see this side panel. Speech still requires your click.</small>
    </section>
  );
}
