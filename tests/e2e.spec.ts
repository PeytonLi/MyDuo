import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import neo4j, { type Driver } from "neo4j-driver";

test.describe.configure({ mode: "serial" });

const accessSecret = process.env.DEMO_ACCESS_SECRET;
if (!accessSecret) throw new Error("DEMO_ACCESS_SECRET is required for browser regression tests");

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Access secret").fill(accessSecret!);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Give your Duo the context you already carry." })).toBeVisible();
}

function databaseDriver() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !username || !password) throw new Error("Neo4j variables are required for browser regression tests");
  return neo4j.driver(uri, neo4j.auth.basic(username, password));
}

async function withSession(driver: Driver) {
  const sessionId = randomUUID();
  const utteranceId = randomUUID();
  const suggestionId = randomUUID();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
  try {
    await session.run(
      `MATCH (p:Project {id: $projectId, ownerId: 'demo-owner'})
       CREATE (s:Session {
         id: $sessionId, ownerId: 'demo-owner', projectId: p.id,
         meetingUrl: 'https://meet.google.com/abc-defg-hij', status: 'listening',
         transcriptRevision: 1, stopRevision: 0, mediaLastSeenAt: $mediaLastSeenAt,
         createdAt: $now, updatedAt: $now
       })
       CREATE (p)-[:HAS_SESSION]->(s)
       CREATE (u:Utterance {
         id: $utteranceId, sessionId: $sessionId, speakerId: 'person-1', speakerName: 'Alex',
         text: 'Can the public launch happen Friday?', startMs: 1000, endMs: 3000,
         revision: 1, isBot: false, createdAt: $now
       })
       CREATE (s)-[:HAS_UTTERANCE]->(u)
       CREATE (g:Suggestion {
         id: $suggestionId, ownerId: 'demo-owner', sessionId: $sessionId,
         version: 1, mode: 'answer', text: 'The public launch waits for the security review.',
         evidenceIds: [], evidenceJson: '[]', basis: 'notes', transcriptRevision: 1,
         responseTargetJson: $responseTargetJson,
         status: 'ready', createdAt: $now
       })
       CREATE (s)-[:HAS_SUGGESTION]->(g)`,
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        sessionId,
        utteranceId,
        suggestionId,
        now: new Date().toISOString(),
        mediaLastSeenAt: new Date(Date.now() + 60_000).toISOString(),
        responseTargetJson: JSON.stringify([{ id: utteranceId, speakerName: "Alex", text: "Can the public launch happen Friday?" }]),
      },
    );
  } finally {
    await session.close();
  }
  return { sessionId };
}

async function deleteSession(driver: Driver, sessionId: string) {
  const session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
  try {
    await session.run(
      `MATCH (n)
       WHERE n.sessionId = $sessionId OR n.scopedSessionId = $sessionId OR (n:Session AND n.id = $sessionId)
       DETACH DELETE n`,
      { sessionId },
    );
  } finally {
    await session.close();
  }
}

async function withEndedReviewSession(driver: Driver) {
  const sessionId = randomUUID();
  const projectId = randomUUID();
  const utteranceId = randomUUID();
  const candidateId = randomUUID();
  const sourceId = randomUUID();
  const factId = randomUUID();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
  try {
    await session.run(
      `CREATE (project:Project {id: $projectId, ownerId: 'demo-owner', name: 'Browser review regression'})
       CREATE (s:Session {
         id: $sessionId, ownerId: 'demo-owner', projectId: $projectId,
         meetingUrl: 'https://meet.google.com/abc-defg-hij', status: 'ended',
         transcriptRevision: 1, stopRevision: 0, reviewExtractionStatus: 'ready',
         createdAt: $now, updatedAt: $now
       })
       CREATE (u:Utterance {
         id: $utteranceId, sessionId: $sessionId, speakerName: 'Alex',
         text: 'We agreed the integration ships after the audit.', startMs: 1000, endMs: 3000,
         revision: 1, isBot: false, createdAt: $now
       })
       CREATE (c:ReviewCandidate {
         id: $candidateId, ownerId: 'demo-owner', sessionId: $sessionId, projectId: $projectId,
         factKind: 'dependency', text: 'The integration ships after the audit.', ownerName: null,
         evidenceIds: [$utteranceId], status: 'pending', position: 0,
         sourceId: $sourceId, factId: $factId, createdAt: $now
       })
       CREATE (project)-[:HAS_SESSION]->(s)
       CREATE (s)-[:HAS_UTTERANCE]->(u)
       CREATE (s)-[:HAS_REVIEW_CANDIDATE]->(c)`,
      { projectId, sessionId, utteranceId, candidateId, sourceId, factId, now: new Date().toISOString() },
    );
  } finally {
    await session.close();
  }
  return { sessionId, projectId, sourceId, factId };
}

async function deleteReviewSession(driver: Driver, fixture: { sessionId: string; projectId: string; sourceId: string; factId: string }) {
  const session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
  try {
    await session.run(
      `MATCH (n)
       WHERE n.sessionId = $sessionId OR n.scopedSessionId = $sessionId OR (n:Session AND n.id = $sessionId)
          OR n.id IN [$projectId, $sourceId, $factId]
       DETACH DELETE n`,
      { ...fixture },
    );
  } finally {
    await session.close();
  }
}

test("logged-out access is private and login validation is clear", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stay in the conversation." })).toBeVisible();
  await expect(page.getByLabel("Access secret")).toHaveAttribute("autocomplete", "current-password");
  expect((await page.request.get("/api/profile")).status()).toBe(401);
  expect((await page.request.get("/api/voices")).status()).toBe(401);
  expect((await page.request.post("/api/voices", { data: { voiceId: "EXAVITQu4vr4xnSDxMaL" }, headers: { authorization: `Bearer ${"a".repeat(32)}` } })).status()).toBe(401);
  await page.getByLabel("Access secret").fill("not-the-secret");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".form-message")).toContainText("not valid");
  expect(errors).toEqual([]);
});

test("operator can save an approved memory note", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  const title = `Browser regression ${randomUUID()}`;
  await page.getByLabel("Note title").fill(title);
  await page.getByLabel("What should MyDuo remember?").fill("The demo begins after the host admits MyDuo.");
  await page.getByLabel("Allow in meeting suggestions").check();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/memory") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add to memory" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(page.getByRole("status")).toContainText("Note added");
  await expect(page.getByText(title)).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".saved-note", { hasText: title }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toContainText("Note deleted");
  await expect(page.getByText(title)).toHaveCount(0);
  expect((await page.request.get("/api/memory")).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test("meeting draft edits, stale protection, and end state survive polling", async ({ page }) => {
  const errors = watchErrors(page);
  const driver = databaseDriver();
  const fixture = await withSession(driver);
  try {
    await login(page);
    const activeMeeting = page.locator(".history-item").first();
    await expect(page.getByRole("heading", { name: "Recent meetings" })).toBeVisible();
    await expect(activeMeeting).toContainText("listening");
    await expect(activeMeeting.getByRole("button", { name: "Resume" })).toBeVisible();
    await page.goto(`/meeting/${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(page.locator(".utterance", { hasText: "Can the public launch happen Friday?" })).toBeVisible();
    await expect(page.locator(".response-target")).toContainText("Responding to");
    await expect(page.locator(".response-target")).toContainText("Can the public launch happen Friday?");
    const draft = page.getByLabel("Suggested words");
    await expect(draft).toHaveValue("The public launch waits for the security review.");
    await draft.fill("The public launch waits for the completed security review.");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(page.getByRole("status")).toContainText("Edit saved");

    const session = driver.session({ database: process.env.NEO4J_DATABASE || "neo4j" });
    try {
      await session.run("MATCH (s:Session {id: $sessionId}) SET s.transcriptRevision = 2", { sessionId: fixture.sessionId });
    } finally {
      await session.close();
    }
    await expect(page.locator(".stale-warning")).toContainText("conversation moved on", { timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Speak to meeting" })).toBeDisabled();
    await page.getByRole("button", { name: "Still relevant — review again" }).click();
    await expect(page.getByRole("button", { name: "Speak to meeting" })).toBeEnabled();
    await page.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText("ended", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await deleteSession(driver, fixture.sessionId);
    await driver.close();
  }
});

test("core controls fit the viewport and expose accessible names", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await expect(page.getByLabel("Your role")).toBeVisible();
  await expect(page.getByLabel("Preferred tone")).toBeVisible();
  await expect(page.getByRole("group", { name: "MyDuo voice" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(3);
  expect((await page.request.post("/api/voices", { data: { voiceId: "not-an-allowed-voice" } })).status()).toBe(400);
  await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("auto-suggest toggle reflects operator intent without drafting", async ({ page }) => {
  const errors = watchErrors(page);
  const driver = databaseDriver();
  const fixture = await withSession(driver);
  try {
    await login(page);
    await page.goto(`/meeting/${fixture.sessionId}`);
    const toggle = page.getByRole("button", { name: "Auto-suggest questions" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator(".meeting-notice")).toContainText("Automatic private questions are on.");
    await expect(page.getByRole("button", { name: "Pause automatic questions" })).toBeVisible();
    const state = await (await page.request.get(`/api/sessions/${fixture.sessionId}/auto-suggestions`)).json() as { enabled: boolean };
    expect(state.enabled).toBe(true);
    await page.getByRole("button", { name: "Pause automatic questions" }).click();
    await expect(page.locator(".meeting-notice")).toContainText("Automatic questions paused");
    expect(errors).toEqual([]);
  } finally {
    await deleteSession(driver, fixture.sessionId);
    await driver.close();
  }
});

test("ended meeting review saves curated memory", async ({ page }) => {
  const errors = watchErrors(page);
  const driver = databaseDriver();
  const fixture = await withEndedReviewSession(driver);
  try {
    await login(page);
    const recentMeeting = page.locator(".history-item", { hasText: "Browser review regression" });
    await expect(recentMeeting).toBeVisible();
    await recentMeeting.getByRole("link", { name: "Review memory" }).click();
    await expect(page.getByRole("heading", { name: "What should MyDuo remember?" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Memory", exact: true })).toHaveValue("The integration ships after the audit.");
    await page.getByLabel("Save this memory").check();
    await page.getByRole("button", { name: "Save accepted" }).click();
    await expect(page.getByRole("status")).toContainText("1 memory item saved.");
    const memory = await (await page.request.get("/api/memory")).json() as { facts: { id: string; text: string; kind: string }[] };
    const saved = memory.facts.find((fact) => fact.id === fixture.factId);
    expect(saved?.text).toBe("The integration ships after the audit.");
    expect(saved?.kind).toBe("dependency");
    expect(errors).toEqual([]);
  } finally {
    await deleteReviewSession(driver, fixture);
    await driver.close();
  }
});

test("quick note captures during the meeting and surfaces in review", async ({ page }) => {
  const errors = watchErrors(page);
  const driver = databaseDriver();
  const fixture = await withSession(driver);
  try {
    await login(page);
    await page.goto(`/meeting/${fixture.sessionId}`);
    const noteBox = page.getByLabel("Quick note saved for review after the meeting");
    await expect(noteBox).toBeVisible();
    await page.locator(".utterance", { hasText: "Can the public launch happen Friday?" }).click();
    await noteBox.fill("Alex asked about the Friday launch.");
    await page.getByRole("button", { name: "Capture" }).click();
    await expect(page.getByRole("status")).toContainText("Note captured with 1 selected line");
    await expect(noteBox).toHaveValue("");

    await page.getByRole("button", { name: "End session" }).click();
    await expect(page.getByText("ended", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Review meeting memory" }).click();
    await expect(page.getByRole("heading", { name: "What should MyDuo remember?" })).toBeVisible();
    const memoryBox = page.getByRole("textbox", { name: "Memory", exact: true });
    await expect(memoryBox.first()).toHaveValue("Alex asked about the Friday launch.", { timeout: 30_000 });
    await page.getByLabel("Save this memory").first().check();
    await page.getByRole("button", { name: "Save accepted" }).click();
    await expect(page.getByRole("status")).toContainText("1 memory item saved.", { timeout: 30_000 });
    expect(errors).toEqual([]);
  } finally {
    await deleteSession(driver, fixture.sessionId);
    await driver.close();
  }
});

test("meet side panel pairs one-use with the active session", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  await page.goto("/meet-addon");
  await expect(page.getByRole("heading", { name: "Pair with your active session" })).toBeVisible();
  await expect(page.getByLabel("Pairing code")).toBeVisible();

  const driver = databaseDriver();
  const fixture = await withSession(driver);
  try {
    const paired = await page.request.post("/api/addon/pair", { data: { sessionId: fixture.sessionId } });
    expect(paired.ok()).toBe(true);
    const { code } = await paired.json() as { code: string };
    const exchanged = await page.request.post("/api/addon/exchange", { data: { code } });
    expect(exchanged.ok()).toBe(true);
    const body = await exchanged.json() as { sessionId: string; token: string };
    expect(body.sessionId).toBe(fixture.sessionId);
    expect((await page.request.post("/api/addon/exchange", { data: { code } })).status()).toBe(401);

    const captured = await page.request.post(`/api/sessions/${fixture.sessionId}/quick-notes`, {
      data: { text: "Panel captured this note.", selectedUtteranceIds: [] },
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(captured.status()).toBe(201);
    expect(errors).toEqual([]);
  } finally {
    await deleteSession(driver, fixture.sessionId);
    await driver.close();
  }
});
