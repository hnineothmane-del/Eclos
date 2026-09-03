import type { RelationshipState } from '../types/relationship.js';

export type RivalRelationshipPhase = 'introductory' | 'familiar' | 'trusted' | 'bonded';

/**
 * A pure interpretation of authoritative relationship dimensions. These are
 * permissions for delivery and context selection, never a second score or
 * a source of relationship updates.
 */
export interface RivalRelationshipContext {
  phase: RivalRelationshipPhase;
  callbackDepth: 1 | 2 | 3 | 4;
  teasingWarmth: number;
  sincerityPermission: number;
  disclosurePermission: number;
  nicknameEligible: boolean;
  challengeRespect: number;
  roastReciprocity: number;
  directives: string[];
}

const clamp = (value: number) => Math.max(0, Math.min(10, Math.round(value)));

export function deriveRivalRelationshipContext(relationship: RelationshipState): RivalRelationshipContext {
  const { familiarity, trust, respect, warmth, rivalry, curiosity } = relationship;
  const bonded = familiarity >= 75 && trust >= 70 && respect >= 60 && warmth >= 55;
  const trusted = !bonded && familiarity >= 55 && trust >= 55 && respect >= 45;
  const familiar = !bonded && !trusted && familiarity >= 30 && (trust >= 25 || warmth >= 25 || respect >= 35);
  const phase: RivalRelationshipPhase = bonded ? 'bonded' : trusted ? 'trusted' : familiar ? 'familiar' : 'introductory';

  const callbackDepth: 1 | 2 | 3 | 4 = phase === 'bonded' ? 4 : phase === 'trusted' ? 3 : phase === 'familiar' ? 2 : 1;
  const teasingWarmth = clamp((warmth * 0.55 + familiarity * 0.25 + trust * 0.2) / 10);
  const sincerityPermission = clamp((trust * 0.45 + respect * 0.35 + warmth * 0.2) / 10);
  const disclosurePermission = clamp((familiarity * 0.35 + trust * 0.45 + warmth * 0.2) / 10);
  const challengeRespect = clamp((respect * 0.7 + rivalry * 0.3) / 10);
  const roastReciprocity = clamp((familiarity * 0.5 + trust * 0.3 + rivalry * 0.2) / 10);
  const directives = [
    'Keep the Rival core personality intact; relationship depth changes delivery, not identity.',
    'Do not manufacture attachment, guilt the user for leaving, or make warmth into generic coaching.',
  ];
  if (phase === 'introductory') directives.push('Use only immediate, relevant context. Do not assume shared history or emotional closeness.');
  if (phase === 'familiar') directives.push('Established callbacks and teasing are permitted when directly relevant.');
  if (phase === 'trusted') directives.push('Specific observations and concise, proportionate recognition are permitted after meaningful behavior.');
  if (phase === 'bonded') directives.push('Deep shared-history callbacks and rare, restrained honesty are permitted only when context earns them.');
  if (familiarity >= 55 && trust < 40) directives.push('The Rival knows the user well but remains skeptical; do not confuse familiarity with trust.');
  if (respect >= 70 && warmth < 40) directives.push('Give concise respect for competence without forcing affection.');
  if (rivalry >= 70 && respect >= 60) directives.push('Competitive framing is welcome, but respect demonstrated competence.');
  if (curiosity >= 70 && familiarity < 30) directives.push('Ask or test rather than acting over-familiar.');

  return {
    phase,
    callbackDepth,
    teasingWarmth,
    sincerityPermission,
    disclosurePermission,
    nicknameEligible: phase === 'bonded' && trust >= 75 && warmth >= 60 && respect >= 60,
    challengeRespect,
    roastReciprocity,
    directives,
  };
}
