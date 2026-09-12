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

test("logged-out access is private and login validation is clear", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Stay in the conversation." })).toBeVisible();
  await expect(page.getByLabel("Access secret")).toHaveAttribute("autocomplete", "current-password");
  expect((await page.request.get("/api/profile")).status()).toBe(401);
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
  const source = await response.json() as { id: string };
  await expect(page.getByRole("status")).toContainText("Note added");
  await expect(page.getByText(title)).toBeVisible();
  try {
    expect(errors).toEqual([]);
  } finally {
    const deleted = await page.request.delete("/api/memory", { data: { kind: "source", id: source.id } });
    expect(deleted.ok()).toBe(true);
  }
});

test("meeting draft edits, stale protection, and end state survive polling", async ({ page }) => {
  const errors = watchErrors(page);
  const driver = databaseDriver();
  const fixture = await withSession(driver);
  try {
    await login(page);
    await page.goto(`/meeting/${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(page.getByText("Can the public launch happen Friday?")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
