export type MemoryTier = 'permanent' | 'decaying';

export type MemoryCategory =
  | 'goal'
  | 'achievement'
  | 'failure'
  | 'commitment'
  | 'milestone'
  | 'running_joke'
  | 'observation'
  | 'preference';

export interface MemoryItem {
  id: string;
  userId: string;
  tier: MemoryTier;
  category: MemoryCategory;
  key: string;
  value: Record<string, unknown> | string | number | boolean;
  strength: number; // 0-100
  lastAccessedAt: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HumorLedgerItem {
  id: string;
  userId: string;
  theme: string;
  target: string;
  intensity: number; // 1-10
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
}
