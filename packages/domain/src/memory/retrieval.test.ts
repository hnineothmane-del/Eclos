import { describe, it, expect } from 'vitest';
import { rankMemories, RETRIEVAL_CONSTANTS } from './retrieval.js';
import type { MemoryItem } from '../types/index.js';

const R = RETRIEVAL_CONSTANTS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<MemoryItem> & { id: string }): MemoryItem {
  return {
    userId: 'user-1',
    tier: 'decaying',
    category: 'achievement',
    key: 'test_key',
    value: 'test_value',
    strength: 80,
    lastAccessedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = '2026-08-29T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rankMemories', () => {
  describe('tier priority', () => {
    it('permanent tier scores higher than decaying (same age, no tags)', () => {
      const items = [
        makeItem({ id: 'a', tier: 'decaying' }),
        makeItem({ id: 'b', tier: 'permanent' }),
      ];
      const result = rankMemories(items, { nowIso: NOW });
      expect(result[0].item.id).toBe('b');
    });

    it('permanent tier score is 20, decaying is 10', () => {
      const perm = makeItem({ id: 'p', tier: 'permanent', createdAt: NOW });
      const decay = makeItem({ id: 'd', tier: 'decaying', createdAt: NOW });
      const [rPerm] = rankMemories([perm], { nowIso: NOW });
      const [rDecay] = rankMemories([decay], { nowIso: NOW });
      expect(rPerm.score).toBeGreaterThan(rDecay.score);
      expect(rPerm.score - rDecay.score).toBeCloseTo(R.TIER_SCORE.permanent - R.TIER_SCORE.decaying);
    });
  });

  describe('tag relevance', () => {
    it('item matching a tag scores higher than non-matching', () => {
      const tagged = makeItem({ id: 'tagged', category: 'achievement', key: 'milestone' });
      const plain = makeItem({ id: 'plain', category: 'failure', key: 'unknown' });
      const result = rankMemories([plain, tagged], {
        nowIso: NOW,
        tags: ['milestone'],
      });
      expect(result[0].item.id).toBe('tagged');
    });

    it('tag match adds TAG_MATCH_WEIGHT per match', () => {
      const item = makeItem({ id: 'x', category: 'goal', key: 'running', createdAt: NOW });
      const [r] = rankMemories([item], { nowIso: NOW, tags: ['goal'] });
      // Should have at least tier + one tag match
      const baselineDecay = rankMemories([makeItem({ id: 'baseline', createdAt: NOW })], { nowIso: NOW });
      expect(r.score).toBeGreaterThan(baselineDecay[0].score);
    });
  });

  describe('recency', () => {
    it('more recent item scores higher than older item of same tier', () => {
      const recent = makeItem({ id: 'recent', createdAt: '2026-08-28T00:00:00.000Z' });
      const old = makeItem({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z' });
      const result = rankMemories([old, recent], { nowIso: NOW });
      expect(result[0].item.id).toBe('recent');
    });

    it('recency score is 10 for age=0', () => {
      const item = makeItem({ id: 'x', createdAt: NOW });
      const [r] = rankMemories([item], { nowIso: NOW });
      expect(r.score - R.TIER_SCORE.decaying).toBeCloseTo(10, 1);
    });

    it('recency score is ~5 at 14 days (half-life)', () => {
      const item = makeItem({ id: 'x', createdAt: '2026-08-15T00:00:00.000Z' });
      const [r] = rankMemories([item], { nowIso: NOW });
      const recency = r.score - R.TIER_SCORE.decaying;
      expect(recency).toBeCloseTo(5, 0);
    });
  });

  describe('recent-reference suppression', () => {
    it('applies penalty when referenced within 30 minutes', () => {
      const item = makeItem({ id: 'x', createdAt: NOW });
      const tenMinsAgo = '2026-08-28T23:50:00.000Z';
      const [withPenalty] = rankMemories([item], {
        nowIso: NOW,
        lastReferencedAtIso: { x: tenMinsAgo },
      });
      const [without] = rankMemories([item], { nowIso: NOW });
      expect(without.score - withPenalty.score).toBeCloseTo(R.REPEAT_SUPPRESSION_PENALTY, 1);
    });

    it('no penalty when referenced more than 30 minutes ago', () => {
      const item = makeItem({ id: 'x', createdAt: NOW });
      const twoHoursAgo = '2026-08-28T22:00:00.000Z';
      const [withOld] = rankMemories([item], {
        nowIso: NOW,
        lastReferencedAtIso: { x: twoHoursAgo },
      });
      const [without] = rankMemories([item], { nowIso: NOW });
      expect(withOld.score).toBeCloseTo(without.score, 2);
    });
  });

  describe('tie-breaking', () => {
    it('ties broken by createdAt DESC then id ASC', () => {
      // Same tier, same age, no tags → tie broken by id asc
      const a = makeItem({ id: 'aaa', createdAt: NOW, tier: 'decaying' });
      const b = makeItem({ id: 'bbb', createdAt: NOW, tier: 'decaying' });
      const result = rankMemories([b, a], { nowIso: NOW });
      expect(result[0].item.id).toBe('aaa');
      expect(result[1].item.id).toBe('bbb');
    });
  });

  describe('top-K', () => {
    it('returns at most DEFAULT_TOP_K items', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makeItem({ id: `item-${i}` }),
      );
      const result = rankMemories(items, { nowIso: NOW });
      expect(result.length).toBeLessThanOrEqual(R.DEFAULT_TOP_K);
    });

    it('respects custom topK', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makeItem({ id: `item-${i}` }),
      );
      const result = rankMemories(items, { nowIso: NOW, topK: 3 });
      expect(result.length).toBe(3);
    });
  });

  describe('purity (no mutation)', () => {
    it('does not mutate input array', () => {
      const items: MemoryItem[] = [
        makeItem({ id: 'x', tier: 'decaying' }),
        makeItem({ id: 'y', tier: 'permanent' }),
      ];
      const originalOrder = items.map((i) => i.id);
      rankMemories(items, { nowIso: NOW });
      expect(items.map((i) => i.id)).toEqual(originalOrder);
    });

    it('does not mutate item objects', () => {
      const item = makeItem({ id: 'x' });
      const originalId = item.id;
      rankMemories([item], { nowIso: NOW });
      expect(item.id).toBe(originalId);
    });

    it('returns empty array for empty input', () => {
      const result = rankMemories([], { nowIso: NOW });
      expect(result).toEqual([]);
    });
  });
});
