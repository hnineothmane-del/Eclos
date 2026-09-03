/**
 * Verified live-world context boundary.
 *
 * Providers are intentionally injected. The domain never browses, retries,
 * or decides that an external fact is true; it only validates a bounded item
 * that a trusted provider returned.
 */
export type ExternalContextCategory = 'news' | 'weather' | 'sports' | 'culture' | 'technology' | 'general';
export type ExternalContextRelevance = 'high' | 'medium' | 'low';

export interface VerifiedExternalContext {
  id: string;
  source: string;
  retrievedAt: string;
  category: ExternalContextCategory;
  title: string;
  summary: string;
  relevance: ExternalContextRelevance;
  confidence: number;
  expiresAt: string | null;
  sourceUrl: string | null;
}

export interface ExternalContextRequest {
  query: string;
  nowIso: string;
  reason: 'explicit_current_query' | 'ambient_opportunity';
}

export interface ExternalContextProvider {
  getRelevantContext(request: ExternalContextRequest): Promise<readonly VerifiedExternalContext[]>;
}

const FRESHNESS_MS: Record<ExternalContextCategory, number> = {
  news: 6 * 60 * 60 * 1000,
  weather: 6 * 60 * 60 * 1000,
  sports: 2 * 60 * 60 * 1000,
  culture: 7 * 24 * 60 * 60 * 1000,
  technology: 48 * 60 * 60 * 1000,
  general: 48 * 60 * 60 * 1000,
};

const MAX_ITEMS = 1;
const MAX_ID = 120;
const MAX_SOURCE = 120;
const MAX_TITLE = 240;
const MAX_SUMMARY = 900;
const MAX_URL = 2048;

function validDate(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function validSourceUrl(value: string | null): boolean {
  if (value === null) return true;
  if (!bounded(value, MAX_URL)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function relevanceRank(value: ExternalContextRelevance): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function queryTerms(query: string): string[] {
  return query.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((term, index, all) =>
    !['what', 'when', 'where', 'which', 'this', 'that', 'today', 'latest', 'happening', 'talking', 'news', 'current', 'right', 'now', 'everyone'].includes(term)
      && all.indexOf(term) === index,
  ) || [];
}

function isTopicallyRelevant(item: VerifiedExternalContext, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return item.relevance === 'high';
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return terms.some((term) => text.includes(term));
}

function isFresh(item: VerifiedExternalContext, nowMs: number): boolean {
  const retrievedMs = new Date(item.retrievedAt).getTime();
  if (!Number.isFinite(retrievedMs) || retrievedMs > nowMs) return false;
  if (item.expiresAt !== null) {
    const expiresMs = new Date(item.expiresAt).getTime();
    if (!Number.isFinite(expiresMs) || nowMs > expiresMs || expiresMs <= retrievedMs) return false;
  }
  return nowMs - retrievedMs <= FRESHNESS_MS[item.category];
}

/** Validates and selects at most one fresh, relevant provider result. */
export function selectVerifiedExternalContext(
  items: readonly VerifiedExternalContext[],
  query: string,
  nowIso: string,
): VerifiedExternalContext | null {
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(nowMs)) return null;
  const valid = items.filter((item) =>
    bounded(item.id, MAX_ID)
    && bounded(item.source, MAX_SOURCE)
    && validDate(item.retrievedAt)
    && ['news', 'weather', 'sports', 'culture', 'technology', 'general'].includes(item.category)
    && bounded(item.title, MAX_TITLE)
    && bounded(item.summary, MAX_SUMMARY)
    && ['high', 'medium', 'low'].includes(item.relevance)
    && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1
    && (item.expiresAt === null || validDate(item.expiresAt))
    && validSourceUrl(item.sourceUrl)
    && isFresh(item, nowMs)
    && isTopicallyRelevant(item, query),
  );
  valid.sort((a, b) => relevanceRank(b.relevance) - relevanceRank(a.relevance) || b.confidence - a.confidence || b.retrievedAt.localeCompare(a.retrievedAt) || a.id.localeCompare(b.id));
  return valid.slice(0, MAX_ITEMS)[0] || null;
}

const CURRENT_QUERY_TERMS = [
  'today', 'currently', 'current', 'latest', 'happening', 'news', 'trending',
  'right now', 'what happened', 'what is happening', 'why is everyone talking',
  'what are people talking about', 'in the world',
] as const;

function looksCurrentWorldRelated(input: string): boolean {
  const normalized = input.toLowerCase();
  return CURRENT_QUERY_TERMS.some((term) => normalized.includes(term));
}

function isSeriousInput(input: string): boolean {
  const normalized = input.toLowerCase();
  return ['suicid', 'self harm', 'self-harm', 'want to die', 'grief', 'funeral', 'abuse', 'panic attack', 'hopeless'].some((term) => normalized.includes(term));
}

/** Determines whether a provider may be called. It never performs I/O. */
export function deriveExternalContextRequest(input: {
  userInput: string;
  nowIso: string;
  activeChallenge?: { status: string } | null;
  presenceAction?: string | null;
  serious?: boolean;
}): ExternalContextRequest | null {
  const challengeProtected = ['accepted', 'started', 'attempted', 'evidence_submitted', 'needs_more_evidence'].includes(input.activeChallenge?.status || '');
  if (challengeProtected || input.serious || isSeriousInput(input.userInput)) return null;
  if (looksCurrentWorldRelated(input.userInput)) {
    return { query: input.userInput.trim().slice(0, 240), nowIso: input.nowIso, reason: 'explicit_current_query' };
  }
  if (input.presenceAction === 'rare_character_event') {
    return { query: 'current world context relevant to a brief character aside', nowIso: input.nowIso, reason: 'ambient_opportunity' };
  }
  return null;
}

export async function retrieveVerifiedExternalContext(
  provider: ExternalContextProvider | undefined,
  request: ExternalContextRequest | null,
): Promise<VerifiedExternalContext | null> {
  if (!provider || !request) return null;
  try {
    const items = await provider.getRelevantContext(request);
    return selectVerifiedExternalContext(items, request.query, request.nowIso);
  } catch {
    // External context is optional. Provider failure must not affect the turn.
    return null;
  }
}
