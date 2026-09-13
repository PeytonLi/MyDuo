export type QualitySample = {
  expectedEvidenceIds: string[];
  actualEvidenceIds: string[];
  claimCount: number;
  supportedClaimCount: number;
  generatedText?: string;
  approvedText?: string;
  generationMs?: number;
  approvalToAudioMs?: number;
};

export type QualitySummary = {
  cases: number;
  evidencePrecision: number;
  evidenceRecall: number;
  unsupportedClaimRate: number;
  approvalRate: number;
  averageNormalizedEditDistance: number;
  generationP50Ms: number | null;
  generationP95Ms: number | null;
  approvalToAudioP50Ms: number | null;
  approvalToAudioP95Ms: number | null;
};

const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;

export function normalizedEditDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length || !right.length) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length] / Math.max(left.length, right.length);
}

function percentile(values: number[], value: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(value * sorted.length) - 1];
}

export function summarizeQuality(samples: QualitySample[]): QualitySummary {
  let expected = 0;
  let actual = 0;
  let matched = 0;
  let claims = 0;
  let supportedClaims = 0;
  const edits: number[] = [];
  const generationTimes: number[] = [];
  const audioTimes: number[] = [];

  for (const sample of samples) {
    const expectedSet = new Set(sample.expectedEvidenceIds);
    const actualSet = new Set(sample.actualEvidenceIds);
    expected += expectedSet.size;
    actual += actualSet.size;
    matched += [...actualSet].filter((id) => expectedSet.has(id)).length;
    claims += sample.claimCount;
    supportedClaims += Math.min(sample.claimCount, sample.supportedClaimCount);
    if (sample.generatedText && sample.approvedText) edits.push(normalizedEditDistance(sample.generatedText, sample.approvedText));
    if (sample.generationMs !== undefined) generationTimes.push(sample.generationMs);
    if (sample.approvalToAudioMs !== undefined) audioTimes.push(sample.approvalToAudioMs);
  }

  return {
    cases: samples.length,
    evidencePrecision: ratio(matched, actual),
    evidenceRecall: ratio(matched, expected),
    unsupportedClaimRate: ratio(claims - supportedClaims, claims),
    approvalRate: ratio(edits.length, samples.length),
    averageNormalizedEditDistance: ratio(edits.reduce((total, edit) => total + edit, 0), edits.length),
    generationP50Ms: percentile(generationTimes, 0.5),
    generationP95Ms: percentile(generationTimes, 0.95),
    approvalToAudioP50Ms: percentile(audioTimes, 0.5),
    approvalToAudioP95Ms: percentile(audioTimes, 0.95),
  };
}
