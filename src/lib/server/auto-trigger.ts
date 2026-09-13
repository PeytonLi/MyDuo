import type { AssistanceRequest, TranscriptTurn } from "../contracts";

export type AutoTriggerDecision = {
  shouldDraft: boolean;
  mode: AssistanceRequest["mode"];
  whyNow: string | null;
  responseTargetIds: string[];
};

const questionStart = /^(?:can|could|did|do|does|how|is|should|what|when|where|which|who|why|will|would)\b/i;
const riskSignal = /\b(?:block(?:ed|er|ing|s)?|delay(?:ed|ing|s)?|depend(?:s|ed|ency|encies|ing)?|miss(?:ed|ing)?|risk(?:ed|ing|s)?|slip(?:ped|ping|s)?)\b/i;
const changeSignal = /\b(?:actually|changed?|instead|moved?|new date|no longer|replaced?|updated?)\b/i;
const ownerOrDateGap = /\b(?:who (?:owns|is responsible)|when (?:is|does)|what(?:'s| is) the (?:date|deadline)|due date|still on track)\b/i;

export function decideAutoTrigger(turns: TranscriptTurn[]): AutoTriggerDecision {
  const recent = turns.filter((turn) => !turn.isBot && turn.text.trim()).slice(-4);
  const latest = recent.at(-1);
  if (!latest) return { shouldDraft: false, mode: "clarify", whyNow: null, responseTargetIds: [] };

  const text = latest.text.trim();
  const isQuestion = text.endsWith("?") || questionStart.test(text);
  if (ownerOrDateGap.test(text)) {
    return {
      shouldDraft: true,
      mode: isQuestion ? "answer" : "clarify",
      whyNow: "The meeting raised an unresolved owner or deadline.",
      responseTargetIds: [latest.id],
    };
  }
  if (riskSignal.test(text)) {
    return {
      shouldDraft: true,
      mode: isQuestion ? "answer" : "support",
      whyNow: "A new dependency or schedule risk was mentioned.",
      responseTargetIds: [latest.id],
    };
  }
  if (changeSignal.test(text)) {
    return {
      shouldDraft: true,
      mode: "support",
      whyNow: "A statement may change previously confirmed project context.",
      responseTargetIds: [latest.id],
    };
  }
  if (isQuestion) {
    return {
      shouldDraft: true,
      mode: "answer",
      whyNow: "Someone asked a direct question.",
      responseTargetIds: [latest.id],
    };
  }
  return { shouldDraft: false, mode: "clarify", whyNow: null, responseTargetIds: [] };
}
