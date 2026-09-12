"use client";

import { FormEvent, useEffect, useState } from "react";
import { Wordmark } from "./wordmark";

type Profile = {
  role: string;
  priorities: string;
  tone: string;
  responseExamples: string;
};

type MemorySource = {
  id: string;
  projectId: string;
  title: string;
  text: string;
  allowMeetingUse: boolean;
};

type Project = { id: string; name: string };
type Memory = { projects: Project[]; sources: MemorySource[] };

const emptyProfile: Profile = { role: "", priorities: "", tone: "Clear and concise", responseExamples: "" };

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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<Profile>("/api/profile"), api<Memory>("/api/memory")])
      .then(([savedProfile, memory]) => {
        setProfile({ ...emptyProfile, ...savedProfile });
        setSources(memory.sources ?? []);
        setProjects(memory.projects ?? []);
        setProjectId(memory.projects?.[0]?.id ?? "");
        setSignedIn(true);
      })
      .catch(() => setSignedIn(false));
  }, []);

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
          {sources.length > 0 && <div className="saved-notes"><p className="section-kicker">Ready for this meeting</p>{sources.filter((source) => !projectId || source.projectId === projectId).slice(0, 3).map((source) => <div className="saved-note" key={source.id}><span>{source.title}</span><small>{source.allowMeetingUse ? "Available" : "Private"}</small></div>)}</div>}
        </form>

        {!projects.length && <form className="panel project-panel" onSubmit={addProject}><div className="panel-heading"><span className="step-number">+</span><div><p className="section-kicker">First step</p><h2>Name this project</h2></div></div><label htmlFor="projectName">Project name</label><div className="launch-row"><input id="projectName" name="projectName" maxLength={120} placeholder="Hackathon demo" required /><button className="button button-secondary" disabled={busy}>Create project</button></div></form>}

        <form className="panel launch-panel" onSubmit={startMeeting}>
          <div className="launch-copy"><span className="step-number inverse">03</span><div><p className="section-kicker">Join the room</p><h2>Start a meeting session</h2><p>Your assistant joins as a visible participant. The host may need to admit it.</p></div></div>
          <label htmlFor="meetingUrl">Google Meet link</label>
          <div className="launch-row"><input id="meetingUrl" name="meetingUrl" type="url" placeholder="https://meet.google.com/abc-defg-hij" pattern="https://meet\.google\.com/.+" required /><button className="button button-accent" disabled={busy || !projectId}>{busy ? "Starting…" : "Start MyDuo"}</button></div>
          <label className="check-row consent"><input type="checkbox" required /><span>I confirm that participants know an AI assistant will listen to this meeting.</span></label>
          <p className="screen-share-note">Your suggestions stay in this window, but they can be seen if you share this screen.</p>
        </form>
      </div>
    </main>
  );
}
