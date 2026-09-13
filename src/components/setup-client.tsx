"use client";

import { FormEvent, useEffect, useState } from "react";
import { Wordmark } from "./wordmark";

type Profile = {
  role: string;
  priorities: string;
  tone: string;
  responseExamples: string;
  selectedVoiceId: string;
};

type VoiceOption = { id: string; name: string };

type MemorySource = {
  id: string;
  projectId: string;
  title: string;
  text: string;
  allowMeetingUse: boolean;
};

type Project = { id: string; name: string };
type Memory = { projects: Project[]; sources: MemorySource[] };
type MeetingSummary = {
  id: string;
  projectName: string;
  meetingPlatform: "google_meet" | "zoom";
  status: "joining" | "waiting" | "listening" | "ending" | "ended" | "failed" | "uncertain";
  createdAt: string;
  transcriptCount: number;
  reviewState: "none" | "pending" | "complete";
};

const emptyProfile: Profile = { role: "", priorities: "", tone: "Clear and concise", responseExamples: "", selectedVoiceId: "" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body as T;
}

export function SetupClient() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [previewingVoiceId, setPreviewingVoiceId] = useState("");
  const [previewVoiceId, setPreviewVoiceId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<Profile>("/api/profile"), api<Memory>("/api/memory"), api<VoiceOption[]>("/api/voices"), api<MeetingSummary[]>("/api/sessions")])
      .then(([savedProfile, memory, availableVoices, recentMeetings]) => {
        setProfile({ ...emptyProfile, ...savedProfile });
        setVoices(availableVoices);
        setSources(memory.sources ?? []);
        setProjects(memory.projects ?? []);
        setProjectId(memory.projects?.[0]?.id ?? "");
        setMeetings(recentMeetings);
        setSignedIn(true);
      })
      .catch(() => setSignedIn(false));
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function previewVoice(voiceId: string) {
    setPreviewingVoiceId(voiceId);
    setPreviewVoiceId("");
    setPreviewUrl("");
    setMessage("");
    try {
      const response = await fetch("/api/voices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Could not preview that voice.");
      }
      setPreviewUrl(URL.createObjectURL(await response.blob()));
      setPreviewVoiceId(voiceId);
      setPreviewingVoiceId("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not preview that voice.");
      setPreviewingVoiceId("");
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const secret = new FormData(event.currentTarget).get("secret");
    try {
      await api("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const source = await api<MemorySource>("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "source",
          projectId,
          title: data.get("title"),
          text: data.get("text"),
          allowMeetingUse: data.get("allowedForMeeting") === "on",
        }),
      });
      setSources((current) => [source, ...current]);
      form.reset();
      setMessage("Note added to memory.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save that note.");
    } finally {
      setBusy(false);
    }
  }

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const name = new FormData(form).get("projectName");
    try {
      const project = await api<Project>("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "project", name }),
      });
      setProjects((current) => [...current, project]);
      setProjectId(project.id);
      form.reset();
      setMessage("Project created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create that project.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSource(source: MemorySource) {
    if (!window.confirm(`Delete "${source.title}"? This cannot be undone.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ deleted: boolean; invalidatedSuggestions: number }>("/api/memory", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "source", id: source.id }),
      });
      setSources((current) => current.filter((item) => item.id !== source.id));
      setMessage(result.invalidatedSuggestions
        ? `Note deleted. ${result.invalidatedSuggestions} draft suggestion${result.invalidatedSuggestions === 1 ? "" : "s"} using it ${result.invalidatedSuggestions === 1 ? "was" : "were"} withdrawn.`
        : "Note deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete that note.");
    } finally {
      setBusy(false);
    }
  }

  async function startMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const session = await api<{ id: string }>("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingUrl: data.get("meetingUrl"), projectId, consentConfirmed: true }),
      });
      window.location.assign(new URL(`/meeting/${session.id}`, window.location.origin));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the meeting.");
      api<MeetingSummary[]>("/api/sessions").then(setMeetings).catch(() => undefined);
      setBusy(false);
    }
  }

  async function resumeMeeting(meeting: MeetingSummary) {
    setBusy(true);
    setMessage("");
    try {
      const recovered = meeting.status === "uncertain"
        ? await api<{ status: MeetingSummary["status"] }>(`/api/sessions/${meeting.id}/recover`, { method: "POST" })
        : meeting;
      window.location.assign(recovered.status === "ended" ? `/meeting/${meeting.id}/review` : `/meeting/${meeting.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not recover that meeting.");
      setBusy(false);
    }
  }

  async function endKnownMeeting(meeting: MeetingSummary) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/sessions/${meeting.id}`, { method: "DELETE" });
      setMeetings(await api<MeetingSummary[]>("/api/sessions"));
      setMessage("Meeting ended. You can review its transcript below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not end that meeting.");
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === null) {
    return <main className="center-stage"><p className="eyebrow">Opening your private workspace…</p></main>;
  }

  if (!signedIn) {
    return (
      <main className="login-stage">
        <section className="login-copy">
          <Wordmark />
          <p className="eyebrow">Your second voice, when you want it</p>
          <h1>Stay in the conversation.</h1>
          <p className="lede">MyDuo listens with permission, recalls what matters, and drafts the words you need. Nothing reaches the meeting until you approve it.</p>
          <div className="trust-row" aria-label="How MyDuo works">
            <span>Private drafts</span><span>Evidence attached</span><span>You press speak</span>
          </div>
        </section>
        <form className="login-card" onSubmit={signIn}>
          <p className="section-kicker">Operator access</p>
          <h2>Enter your workspace</h2>
          <label className="sr-only" htmlFor="username">Username</label>
          <input className="sr-only" id="username" name="username" autoComplete="username" value="operator" readOnly tabIndex={-1} />
          <label htmlFor="secret">Access secret</label>
          <input id="secret" name="secret" type="password" autoComplete="current-password" required autoFocus />
          <button className="button button-primary" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
          {message && <p className="form-message" role="alert">{message}</p>}
          <p className="fine-print">This keeps meeting notes and suggestions private on a shared demo URL.</p>
        </form>
      </main>
    );
  }

  return (
    <main className="setup-shell">
      <header className="topbar">
        <Wordmark />
        <span className="privacy-pill"><i /> Private workspace</span>
      </header>

      <section className="setup-intro">
        <div>
          <p className="eyebrow">Meeting preparation</p>
          <h1>Give your Duo the context you already carry.</h1>
        </div>
        <p>Keep it small: your role, how you communicate, and the few decisions that matter today.</p>
      </section>

      {message && <div className="toast" role="status">{message}</div>}

      {meetings.length > 0 && (
        <section className="meeting-history" aria-labelledby="meeting-history-title">
          <div className="history-heading">
            <div><p className="section-kicker">Continue where you left off</p><h2 id="meeting-history-title">Recent meetings</h2></div>
            <span>{meetings.length} saved</span>
          </div>
          <div className="history-list">
            {meetings.map((meeting) => {
              const active = ["joining", "waiting", "listening", "uncertain"].includes(meeting.status);
              return (
                <article className="history-item" key={meeting.id}>
                  <div>
                    <strong>{meeting.projectName}</strong>
                    <p>{meeting.meetingPlatform === "zoom" ? "Zoom" : "Google Meet"} · {new Date(meeting.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })} · {meeting.transcriptCount} transcript line{meeting.transcriptCount === 1 ? "" : "s"}</p>
                  </div>
                  <span className={`history-status history-status-${meeting.status}`}>{meeting.status === "uncertain" ? "Needs recovery" : meeting.status}</span>
                  <div className="history-actions">
                    {active && <button className="button button-ink" type="button" disabled={busy} onClick={() => resumeMeeting(meeting)}>{meeting.status === "uncertain" ? "Recover & resume" : "Resume"}</button>}
                    {active && <button className="text-button danger" type="button" disabled={busy} onClick={() => endKnownMeeting(meeting)}>End</button>}
                    {meeting.status === "ending" && <span>Leaving…</span>}
                    {meeting.status === "ended" && meeting.reviewState === "pending" && <a className="button button-accent" href={`/meeting/${meeting.id}/review`}>Review memory</a>}
                    {meeting.status === "ended" && meeting.reviewState === "complete" && <a className="text-button" href={`/meeting/${meeting.id}/review`}>View review</a>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="setup-grid">
        <form className="panel profile-panel" onSubmit={saveProfile}>
          <div className="panel-heading"><span className="step-number">01</span><div><p className="section-kicker">Your perspective</p><h2>How should MyDuo sound?</h2></div></div>
          <label htmlFor="role">Your role</label>
          <input id="role" value={profile.role} onChange={(event) => setProfile({ ...profile, role: event.target.value })} placeholder="Product lead, student, founder…" maxLength={120} />
          <label htmlFor="priorities">What matters most in this project?</label>
          <textarea id="priorities" value={profile.priorities} onChange={(event) => setProfile({ ...profile, priorities: event.target.value })} placeholder="A clear launch scope, honest tradeoffs, named owners…" maxLength={1000} rows={4} />
          <label htmlFor="tone">Preferred tone</label>
          <select id="tone" value={profile.tone} onChange={(event) => setProfile({ ...profile, tone: event.target.value })}>
            <option>Clear and concise</option><option>Warm and collaborative</option><option>Direct and analytical</option>
          </select>
          <label htmlFor="example">A phrase that sounds like you <span className="optional">optional</span></label>
          <textarea id="example" value={profile.responseExamples} onChange={(event) => setProfile({ ...profile, responseExamples: event.target.value })} placeholder="I think we can do that if we narrow the first release…" maxLength={4000} rows={3} />
          <fieldset className="voice-picker">
            <legend>MyDuo voice</legend>
            {voices.map((voice) => (
              <div className="voice-option" key={voice.id}>
                <label><input type="radio" name="selectedVoiceId" value={voice.id} checked={profile.selectedVoiceId === voice.id} onChange={() => setProfile({ ...profile, selectedVoiceId: voice.id })} /><span>{voice.name}</span></label>
                <button className="text-button" type="button" disabled={Boolean(previewingVoiceId)} onClick={() => previewVoice(voice.id)}>{previewingVoiceId === voice.id && !previewUrl ? "Loading…" : "Preview"}</button>
                {previewVoiceId === voice.id && previewUrl && <audio controls autoPlay src={previewUrl}>Your browser cannot play this preview.</audio>}
              </div>
            ))}
          </fieldset>
          <button className="button button-secondary" disabled={busy}>Save profile</button>
        </form>

        <form className="panel memory-panel" onSubmit={addMemory}>
          <div className="panel-heading"><span className="step-number">02</span><div><p className="section-kicker">Project memory</p><h2>Add a useful note</h2></div></div>
          {projects.length ? <><label htmlFor="project">Project</label><select id="project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></> : <div className="project-empty"><p>Create a project before adding meeting notes.</p></div>}
          <label htmlFor="title">Note title</label>
          <input id="title" name="title" placeholder="Tuesday planning notes" maxLength={200} required />
          <label htmlFor="text">What should MyDuo remember?</label>
          <textarea id="text" name="text" placeholder="The internal preview can happen Friday. Public launch depends on the security review…" maxLength={20000} rows={8} required />
          <label className="check-row"><input name="allowedForMeeting" type="checkbox" /><span><strong>Allow in meeting suggestions</strong><small>Private by default. Turn this on only for notes MyDuo may use in a spoken draft.</small></span></label>
          <button className="button button-secondary" disabled={busy || !projectId}>Add to memory</button>
          {sources.length > 0 && <div className="saved-notes"><p className="section-kicker">Ready for this meeting</p>{sources.filter((source) => !projectId || source.projectId === projectId).slice(0, 3).map((source) => <div className="saved-note" key={source.id}><span>{source.title}</span><small>{source.allowMeetingUse ? "Available" : "Private"}</small><button className="text-button danger" type="button" disabled={busy} onClick={() => deleteSource(source)}>Delete</button></div>)}</div>}
        </form>

        {!projects.length && <form className="panel project-panel" onSubmit={addProject}><div className="panel-heading"><span className="step-number">+</span><div><p className="section-kicker">First step</p><h2>Name this project</h2></div></div><label htmlFor="projectName">Project name</label><div className="launch-row"><input id="projectName" name="projectName" maxLength={120} placeholder="Hackathon demo" required /><button className="button button-secondary" disabled={busy}>Create project</button></div></form>}

        <form className="panel launch-panel" onSubmit={startMeeting}>
          <div className="launch-copy"><span className="step-number inverse">03</span><div><p className="section-kicker">Join the room</p><h2>Start a meeting session</h2><p>Your assistant joins as a visible participant. The host may need to admit it.</p></div></div>
          <label htmlFor="meetingUrl">Google Meet or Zoom link</label>
          <div className="launch-row"><input id="meetingUrl" name="meetingUrl" type="url" placeholder="https://meet.google.com/abc-defg-hij" required /><button className="button button-accent" disabled={busy || !projectId}>{busy ? "Starting…" : "Start MyDuo"}</button></div>
          <label className="check-row consent"><input type="checkbox" required /><span>I confirm that participants know an AI assistant will listen to this meeting.</span></label>
          <p className="screen-share-note">Your suggestions stay in this window, but they can be seen if you share this screen.</p>
        </form>
      </div>
    </main>
  );
}
