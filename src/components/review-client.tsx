"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReviewCandidate } from "@/lib/server/reviews";
import { Wordmark } from "./wordmark";
import styles from "./review.module.css";

type EditableCandidate = ReviewCandidate & { selected: boolean };

async function readJson(response: Response | Promise<Response>) {
  const resolved = await response;
  const body = await resolved.json();
  if (!resolved.ok) throw new Error(body.message || "Something went wrong.");
  return body;
}

export function ReviewClient({ sessionId }: { sessionId: string }) {
  const [candidates, setCandidates] = useState<EditableCandidate[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("Reviewing the transcript…");

  useEffect(() => {
    let active = true;
    readJson(fetch(`/api/sessions/${sessionId}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }))
      .then((body) => {
        if (!active) return;
        setCandidates(body.candidates.map((candidate: ReviewCandidate) => ({ ...candidate, selected: false })));
        setMessage(body.candidates.length ? "Choose only the items you want MyDuo to remember." : "No clear memory items were found.");
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "Unable to prepare the review."))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [sessionId]);

  function update(id: string, values: Partial<EditableCandidate>) {
    setCandidates((current) => current.map((candidate) => candidate.id === id ? { ...candidate, ...values } : candidate));
  }

  async function reject(candidate: EditableCandidate) {
    setBusy(true);
    try {
      const saved = await readJson(fetch(`/api/review-candidates/${candidate.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject" }),
      }));
      update(candidate.id, { ...saved, selected: false });
      setMessage("That item will not be saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reject the item.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccepted() {
    const selected = candidates.filter((candidate) => candidate.status === "pending" && candidate.selected);
    if (!selected.length) return setMessage("Choose at least one item to save.");
    setBusy(true);
    try {
      const saved = await Promise.all(selected.map((candidate) => readJson(fetch(`/api/review-candidates/${candidate.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", factKind: candidate.factKind, text: candidate.text, ownerName: candidate.ownerName }),
      }))));
      const byId = new Map(saved.map((candidate) => [candidate.id, candidate]));
      setCandidates((current) => current.map((candidate) => byId.has(candidate.id) ? { ...candidate, ...byId.get(candidate.id), selected: false } : candidate));
      setMessage(`${saved.length} memory item${saved.length === 1 ? "" : "s"} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the selected memory.");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}><Wordmark /><Link className="text-button" href={`/meeting/${sessionId}`}>Back to meeting</Link></header>
    <section className={styles.intro}>
      <p className="eyebrow">Private meeting review</p>
      <h1>What should MyDuo remember?</h1>
      <p role="status">{message}</p>
    </section>
    <section className={styles.list} aria-busy={busy}>
      {candidates.map((candidate, index) => <article className={`${styles.card} ${candidate.status !== "pending" ? styles.done : ""}`} key={candidate.id}>
        <div className={styles.cardTop}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{candidate.status === "pending" ? "Proposed" : candidate.status}</strong>
        </div>
        <label htmlFor={`type-${candidate.id}`}>Type</label>
        <select id={`type-${candidate.id}`} value={candidate.factKind} disabled={candidate.status !== "pending" || busy} onChange={(event) => update(candidate.id, { factKind: event.target.value as ReviewCandidate["factKind"] })}>
          <option value="decision">Decision</option><option value="dependency">Dependency</option>
          <option value="deadline">Deadline</option><option value="responsibility">Responsibility</option>
        </select>
        <label htmlFor={`text-${candidate.id}`}>Memory</label>
        <textarea id={`text-${candidate.id}`} rows={3} maxLength={2000} value={candidate.text} disabled={candidate.status !== "pending" || busy} onChange={(event) => update(candidate.id, { text: event.target.value })} />
        <label htmlFor={`owner-${candidate.id}`}>Owner <span className="optional">optional</span></label>
        <input id={`owner-${candidate.id}`} maxLength={120} value={candidate.ownerName ?? ""} disabled={candidate.status !== "pending" || busy} onChange={(event) => update(candidate.id, { ownerName: event.target.value || null })} />
        {candidate.status === "pending" && <div className={styles.actions}>
          <label className="check-row"><input type="checkbox" checked={candidate.selected} disabled={busy} onChange={(event) => update(candidate.id, { selected: event.target.checked })} /><span><strong>Save this memory</strong><small>It becomes available in future meetings.</small></span></label>
          <button className="text-button danger" disabled={busy} onClick={() => reject(candidate)}>Reject</button>
        </div>}
      </article>)}
    </section>
    {!busy && candidates.some((candidate) => candidate.status === "pending") && <div className={styles.saveBar}>
      <span>{candidates.filter((candidate) => candidate.status === "pending" && candidate.selected).length} selected</span>
      <button className="button button-accent" onClick={saveAccepted} disabled={busy}>Save accepted</button>
    </div>}
  </main>;
}
