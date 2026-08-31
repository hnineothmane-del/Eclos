import type { Challenge } from '../types/challenge.js';
import type { RelationshipState } from '../types/relationship.js';
import type { ProcessInsight } from '../engine/processInsights.js';
import type { InteractionMode } from '../engine/characterDirector.js';

export type ChallengePrimitive =
  | 'micro_test'
  | 'timed_execution'
  | 'proof_of_work'
  | 'constraint_test'
  | 'knowledge_demonstration'
  | 'recovery_test'
  | 'strategy_switch_test'
  | 'contradiction_test'
  | 'creative_test'
  | 'real_world_action';

export type ChallengeDomain = 'coding' | 'study_learning' | 'writing_creative' | 'physical_task' | 'general';
export type ChallengeOutcome = 'passed' | 'failed' | 'needs_more_evidence';

export interface ChallengeSelectionContext {
  objective: string;
  domain: ChallengeDomain;
  difficulty: number;
  relationship: RelationshipState;
  interactionMode: InteractionMode;
  activeChallenge?: Challenge | null;
  firstSession: boolean;
  recentPrimitives: readonly ChallengePrimitive[];
  recentOutcomes: readonly ChallengeOutcome[];
  processInsights: readonly ProcessInsight[];
  groundedContradiction?: boolean;
}

export interface ChallengeSelection {
  primitive: ChallengePrimitive;
  domain: ChallengeDomain;
  objective: string;
  difficulty: number;
  constraints: string[];
  expectedDurationMinutes: number | null;
  verificationLevel: 'self_report' | 'artifact';
  evidenceExpectation: string;
  reason: string;
}

const domainPreferences: Record<ChallengeDomain, readonly ChallengePrimitive[]> = {
  coding: ['micro_test', 'proof_of_work', 'knowledge_demonstration', 'strategy_switch_test', 'constraint_test'],
  study_learning: ['knowledge_demonstration', 'micro_test', 'timed_execution'],
  writing_creative: ['creative_test', 'proof_of_work', 'constraint_test'],
  physical_task: ['real_world_action', 'timed_execution'],
  general: ['micro_test', 'timed_execution', 'proof_of_work'],
};

const hasInsight = (insights: readonly ProcessInsight[], types: readonly ProcessInsight['type'][]) =>
  insights.some((insight) => types.includes(insight.type));

export function inferChallengeDomain(objective: string): ChallengeDomain {
  const input = objective.toLowerCase();
  if (/(code|coding|program|javascript|typescript|python|debug|software)/.test(input)) return 'coding';
  if (/(study|learn|exam|course|math|history|science|language)/.test(input)) return 'study_learning';
  if (/(write|writing|draft|story|poem|design|creative)/.test(input)) return 'writing_creative';
  if (/(workout|run|exercise|lift|fitness|shape|walk)/.test(input)) return 'physical_task';
  return 'general';
}

function primitiveDetails(primitive: ChallengePrimitive): Omit<ChallengeSelection, 'primitive' | 'domain' | 'objective' | 'difficulty' | 'reason'> {
  switch (primitive) {
    case 'micro_test': return { constraints: ['Keep it under 60 seconds.', 'Show the direct result.'], expectedDurationMinutes: 1, verificationLevel: 'self_report', evidenceExpectation: 'A concise answer or result.' };
    case 'timed_execution': return { constraints: ['Use one focused timebox.', 'Do the work before reorganizing it.'], expectedDurationMinutes: 10, verificationLevel: 'self_report', evidenceExpectation: 'A short report of the completed action.' };
    case 'proof_of_work': return { constraints: ['Produce a concrete artifact.'], expectedDurationMinutes: null, verificationLevel: 'artifact', evidenceExpectation: 'The artifact, output, calculation, draft, or code.' };
    case 'constraint_test': return { constraints: ['Use the stated constraint as part of the test.', 'Explain the tradeoff briefly.'], expectedDurationMinutes: 10, verificationLevel: 'artifact', evidenceExpectation: 'The result plus the constraint you worked under.' };
    case 'knowledge_demonstration': return { constraints: ['Show your reasoning, not just the answer.'], expectedDurationMinutes: 5, verificationLevel: 'self_report', evidenceExpectation: 'An explanation, prediction, or worked answer.' };
    case 'recovery_test': return { constraints: ['Use a different next step than the failed attempt.'], expectedDurationMinutes: 10, verificationLevel: 'self_report', evidenceExpectation: 'What changed and the resulting attempt.' };
    case 'strategy_switch_test': return { constraints: ['Make the changed approach observable.'], expectedDurationMinutes: 10, verificationLevel: 'self_report', evidenceExpectation: 'The new approach and its result.' };
    case 'contradiction_test': return { constraints: ['Turn the stated intention into one visible action.'], expectedDurationMinutes: 5, verificationLevel: 'self_report', evidenceExpectation: 'A concrete action matching the stated goal.' };
    case 'creative_test': return { constraints: ['Make something concrete before revising it.'], expectedDurationMinutes: 10, verificationLevel: 'artifact', evidenceExpectation: 'A draft, design, or other created output.' };
    case 'real_world_action': return { constraints: ['Keep the action ordinary, safe, and reversible.'], expectedDurationMinutes: 10, verificationLevel: 'self_report', evidenceExpectation: 'A concise report of the completed action.' };
  }
}

/** Pure selector. Null means either no challenge is appropriate or one already exists. */
export function selectChallengePrimitive(context: ChallengeSelectionContext): ChallengeSelection | null {
  if (context.activeChallenge || context.interactionMode !== 'challenge_invitation') return null;
  const scores = new Map<ChallengePrimitive, number>();
  domainPreferences[context.domain].forEach((primitive, index) => scores.set(primitive, 20 - index * 2));
  const add = (primitive: ChallengePrimitive, points: number) => scores.set(primitive, (scores.get(primitive) || 0) + points);

  if (context.firstSession) {
    add('micro_test', 12);
    add('knowledge_demonstration', context.domain === 'study_learning' || context.domain === 'coding' ? 7 : 0);
    add('real_world_action', -20);
  }
  if (context.recentOutcomes.slice(-2).every((outcome) => outcome === 'failed') && context.recentOutcomes.length >= 2) add('recovery_test', 22);
  if (context.recentOutcomes.slice(-2).every((outcome) => outcome === 'passed') && context.recentOutcomes.length >= 2) {
    add('constraint_test', 22);
    add('proof_of_work', 3);
  }
  if (hasInsight(context.processInsights, ['stall_then_recovery', 'strategy_switch'])) add('strategy_switch_test', 15);
  if (hasInsight(context.processInsights, ['repeated_strategy_switch'])) add('constraint_test', 12);
  if (hasInsight(context.processInsights, ['initialization_delay'])) { add('micro_test', 8); add('timed_execution', 5); }
  if (hasInsight(context.processInsights, ['persistence_after_failure', 'rapid_recovery'])) add('recovery_test', 10);
  if (context.groundedContradiction) add('contradiction_test', 22);
  if (context.relationship.familiarity >= 55 && context.relationship.trust >= 55) add('constraint_test', 3);
  if (context.relationship.trust < 30) { add('constraint_test', -5); add('contradiction_test', -8); }

  if (context.domain === 'physical_task' && context.recentPrimitives.includes('real_world_action') && context.recentOutcomes.at(-1) === 'passed') {
    add('real_world_action', 12);
  }

  for (const primitive of context.recentPrimitives.slice(-2)) add(primitive, -9);
  const candidates = [...scores.entries()].sort(([leftPrimitive, leftScore], [rightPrimitive, rightScore]) =>
    rightScore - leftScore || leftPrimitive.localeCompare(rightPrimitive),
  );
  const [primitive] = candidates[0] || [];
  if (!primitive) return null;
  const details = primitiveDetails(primitive);
  return {
    primitive,
    domain: context.domain,
    objective: context.objective.trim(),
    difficulty: context.difficulty,
    ...details,
    reason: context.firstSession ? 'first-session activation with clear proof' : `best fit for ${context.domain} and current grounded context`,
  };
}
