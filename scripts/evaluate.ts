import { readFile } from "node:fs/promises";
import { decideAutoTrigger } from "../src/lib/server/auto-trigger";

type Scenario = { name: string; text: string; shouldDraft: boolean; mode: "answer" | "support" | "clarify" };

async function main() {
  const scenarios = JSON.parse(await readFile(new URL("../evals/meeting-scenarios.json", import.meta.url), "utf8")) as Scenario[];
  const failures: string[] = [];

  for (const [index, scenario] of scenarios.entries()) {
    const decision = decideAutoTrigger([{
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      sessionId: "00000000-0000-4000-8000-000000000000",
      speakerId: null,
      speakerName: "Evaluator",
      text: scenario.text,
      startMs: index * 1_000,
      endMs: index * 1_000 + 500,
      isBot: false,
    }]);
    if (decision.shouldDraft !== scenario.shouldDraft || decision.mode !== scenario.mode) {
      failures.push(`${scenario.name}: expected ${scenario.shouldDraft}/${scenario.mode}, got ${decision.shouldDraft}/${decision.mode}`);
    }
  }

  const accuracy = (scenarios.length - failures.length) / scenarios.length;
  console.log(JSON.stringify({ cases: scenarios.length, passed: scenarios.length - failures.length, accuracy, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

void main();
