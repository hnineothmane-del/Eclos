export type RelationshipMode =
  | 'adaptive'
  | 'permanent_rival'
  | 'sparring'
  | 'coaching'
  | 'mocking'
  | 'observing'
  | 'dismissive';

export interface RelationshipState {
  userId: string;
  respect: number; // 0-100
  warmth: number; // 0-100
  trust: number; // 0-100
  rivalry: number; // 0-100
  familiarity: number; // 0-100
  curiosity: number; // 0-100
  mode: RelationshipMode;
  updatedAt: string;
}

export interface RelationshipDeltas {
  respectDelta?: number;
  warmthDelta?: number;
  trustDelta?: number;
  rivalryDelta?: number;
  familiarityDelta?: number;
  curiosityDelta?: number;
}
