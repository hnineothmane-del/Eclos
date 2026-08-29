import { describe, it, expect } from 'vitest';
import { FakeAIProvider } from './fakeProvider.js';
import { RateLimitError } from './errors.js';

describe('FakeAIProvider', () => {
  it('returns default deterministic generate response', async () => {
    const provider = new FakeAIProvider();
    const result = await provider.generate({ prompt: 'Hello world' });

    expect(result).toBeDefined();
    expect(result.response).toBeTruthy();
    expect(result.intent).toBe('roast_and_challenge');
    expect(provider.generateCalls).toHaveLength(1);
    expect(provider.generateCalls[0].prompt).toBe('Hello world');
  });

  it('supports custom configured generate response', async () => {
    const customResponse = {
      response: 'Custom roast text',
      intent: 'custom_intent',
      humorMechanism: 'irony',
      register: 'sarcastic',
      seriousFlag: false,
    };
    const provider = new FakeAIProvider({ defaultGenerateResponse: customResponse });
    const result = await provider.generate({ prompt: 'Test' });

    expect(result.response).toBe('Custom roast text');
    expect(result.intent).toBe('custom_intent');
  });

  it('returns default deterministic evaluation result', async () => {
    const provider = new FakeAIProvider();
    const result = await provider.evaluate({
      challengeObjective: 'Do 50 pushups',
      evidenceKind: 'video',
      evidenceContent: 'pushup_video.mp4',
    });

    expect(result.outcome).toBe('completed');
    expect(result.confidence).toBe(0.95);
    expect(provider.evaluateCalls).toHaveLength(1);
  });

  it('returns default deterministic multimodal result', async () => {
    const provider = new FakeAIProvider();
    const result = await provider.analyzeMultimodal({
      mediaType: 'image/png',
      mediaBase64: 'abc123==',
    });

    expect(result.description).toBeTruthy();
    expect(result.confidence).toBe(0.9);
    expect(provider.analyzeMultimodalCalls).toHaveLength(1);
  });

  it('throws configured errors deterministically', async () => {
    const provider = new FakeAIProvider({
      errorToThrow: new RateLimitError('Simulated rate limit', 60),
    });

    await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(RateLimitError);
    await expect(provider.evaluate({
      challengeObjective: 'test',
      evidenceKind: 'text',
      evidenceContent: 'test',
    })).rejects.toThrow(RateLimitError);
    await expect(provider.analyzeMultimodal({
      mediaType: 'image/png',
      mediaBase64: 'test',
    })).rejects.toThrow(RateLimitError);
  });
});
