import { describe, it, expect } from 'vitest';
import {
  ENGINE_MODULE,
  CHALLENGE_MODULE,
  MEMORY_MODULE,
  AI_MODULE,
  BILLING_MODULE,
  AppInfo,
} from '../index.js';

describe('domain package placeholder exports', () => {
  it('exports expected placeholder constants', () => {
    expect(ENGINE_MODULE).toBe('engine');
    expect(CHALLENGE_MODULE).toBe('challenge');
    expect(MEMORY_MODULE).toBe('memory');
    expect(AI_MODULE).toBe('ai');
    expect(BILLING_MODULE).toBe('billing');
  });

  it('provides AppInfo type', () => {
    const info: AppInfo = {
      name: 'AI Rival',
      version: '0.1.0',
      status: 'ready',
    };
    expect(info.name).toBe('AI Rival');
  });
});
