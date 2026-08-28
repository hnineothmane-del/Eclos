import { describe, it, expect } from 'vitest';
import { formatTitle } from './lib/utils';
import { initialUIState } from './state/placeholder';

describe('web app sanity checks', () => {
  it('formats title correctly', () => {
    expect(formatTitle('  AI Rival  ')).toBe('AI Rival');
  });

  it('initializes UI state', () => {
    expect(initialUIState.isReady).toBe(true);
  });
});
