import type { MemoryItem, MemoryTier } from '../types/index.js';
import { clamp } from '../util/clamp.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RETRIEVAL_CONSTANTS = {
  TIER_SCORE: {
    permanent: 20,
    decaying: 10,
  } as Record<MemoryTier, number>,

  TAG_MATCH_WEIGHT: 5,
  RECENCY_MAX_SCORE: 10,
  RECENCY_HALFLIFE_DAYS: 14,
  REPEAT_SUPPRESSION_WINDOW_MINUTES: 30,
  REPEAT_SUPPRESSION_PENALTY: 8,
  DEFAULT_TOP_K: 8,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankedMemoryItem {
  item: MemoryItem;
  score: number;
}

export interface MemoryRetrievalOptions {
  tags?: readonly string[];
  nowIso: string;           // ISO string — caller provides time (no Date.now())
  lastReferencedAtIso?: Readonly<Record<string, string>>; // itemId → last-accessed ISO
  topK?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60);
}

function recencyScore(createdAt: string, nowIso: string): number {
  const R = RETRIEVAL_CONSTANTS;
  const age = daysBetween(new Date(createdAt), new Date(nowIso));
  // 10 × 0.5^(ageDays / 14)
  return R.RECENCY_MAX_SCORE * Math.pow(0.5, age / R.RECENCY_HALFLIFE_DAYS);
}

function tagOverlapCount(item: MemoryItem, tags: readonly string[]): number {
  if (!tags.length) return 0;
  // Treat category and key as implicit tags; also check value for string tags
  const itemTags = new Set<string>([item.category, item.key]);
  if (typeof item.value === 'string') itemTags.add(item.value);
  return tags.filter((t) => itemTags.has(t)).length;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export function rankMemories(
  items: readonly MemoryItem[],
  options: MemoryRetrievalOptions,
): RankedMemoryItem[] {
  const R = RETRIEVAL_CONSTANTS;
  const tags = options.tags ?? [];
  const topK = options.topK ?? R.DEFAULT_TOP_K;
  const now = new Date(options.nowIso);
  const lastReferenced = options.lastReferencedAtIso ?? {};

  const scored: RankedMemoryItem[] = items.map((item) => {
    let score = 0;

    // 1. Tier score
    score += R.TIER_SCORE[item.tier] ?? 0;

    // 2. Tag overlap
    score += tagOverlapCount(item, tags) * R.TAG_MATCH_WEIGHT;

    // 3. Recency score
    score += recencyScore(item.createdAt, options.nowIso);

    // 4. Repeat suppression penalty
    const lastRef = lastReferenced[item.id];
    if (lastRef) {
      const minutesAgo = minutesBetween(new Date(lastRef), now);
      if (minutesAgo <= R.REPEAT_SUPPRESSION_WINDOW_MINUTES) {
        score -= R.REPEAT_SUPPRESSION_PENALTY;
      }
    }

    return { item, score: clamp(score, -Infinity, Infinity) };
  });

  // Sort: score DESC, createdAt DESC, id ASC
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const dateA = new Date(a.item.createdAt).getTime();
    const dateB = new Date(b.item.createdAt).getTime();
    if (dateB !== dateA) return dateB - dateA;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });

  return scored.slice(0, topK);
}
