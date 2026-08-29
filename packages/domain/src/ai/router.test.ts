import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createModelRouter, DefaultModelRouter } from './router.js';
import { FakeAIProvider } from './fakeProvider.js';
import { GeminiProvider } from './geminiProvider.js';

interface GlobalProcess {
  process?: {
    env?: Record<string, string | undefined>;
  };
}

describe('ModelRouter', () => {
  const globalObj = globalThis as GlobalProcess;
  const originalEnv = globalObj.process?.env;

  beforeEach(() => {
    if (!globalObj.process) {
      globalObj.process = {};
    }
    globalObj.process.env = {
      ...originalEnv,
      GEMINI_API_KEY: 'test-api-key',
      GEMINI_MODEL_CHEAP: 'models/gemini-2.5-flash',
      GEMINI_MODEL_STRONG: 'models/gemini-2.5-pro',
      GEMINI_MODEL_MULTIMODAL: 'models/gemini-2.5-flash-multimodal',
    };
  });

  afterEach(() => {
    if (globalObj.process) {
      globalObj.process.env = originalEnv;
    }
  });

  it('resolves forChat() to configured cheap provider', () => {
    const router = createModelRouter({
      fetchFn: vi.fn(),
    });
    const provider = router.forChat();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('resolves forEvaluation() to configured strong provider', () => {
    const router = createModelRouter({
      fetchFn: vi.fn(),
    });
    const provider = router.forEvaluation();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('resolves forMultimodal() to configured multimodal provider', () => {
    const router = createModelRouter({
      fetchFn: vi.fn(),
    });
    const provider = router.forMultimodal();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('supports custom provider injection', () => {
    const fakeChat = new FakeAIProvider();
    const fakeEval = new FakeAIProvider();
    const fakeMulti = new FakeAIProvider();

    const router = new DefaultModelRouter({
      customProviders: {
        chat: fakeChat,
        evaluation: fakeEval,
        multimodal: fakeMulti,
      },
    });

    expect(router.forChat()).toBe(fakeChat);
    expect(router.forEvaluation()).toBe(fakeEval);
    expect(router.forMultimodal()).toBe(fakeMulti);
  });
});
