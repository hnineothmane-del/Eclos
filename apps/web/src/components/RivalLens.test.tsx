import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RivalLens } from './RivalLens';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({ recordProcessCapture: vi.fn() }));

const profile = {
  domain: 'general' as const,
  allowedModalities: ['text'],
  quickSignals: ['STUCK', 'THINKING', 'GOT IT', 'CHANGING APPROACH'],
  primaryInput: 'text',
  optionalInputs: [],
  maxUploads: 0,
  instructions: "Don't explain shit. Just dump whatever's in your head.",
};

describe('RivalLens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.recordProcessCapture).mockResolvedValue(undefined);
  });

  it('keeps optional process capture available without an AI call', async () => {
    render(<RivalLens challengeId="challenge-1" profile={profile} />);
    expect(screen.getByText('RIVAL LENS')).toBeInTheDocument();
    expect(screen.getByText(/This is optional/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send signal: STUCK' }));
    await waitFor(() => expect(api.recordProcessCapture).toHaveBeenCalledWith(
      'challenge-1', 'process_signal', { signal: 'STUCK' },
    ));

    fireEvent.change(screen.getByLabelText(/Rival Lens thought input/i), { target: { value: 'maybe I am cooked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(api.recordProcessCapture).toHaveBeenCalledWith(
      'challenge-1', 'process_thought', { content: 'maybe I am cooked' },
    ));
  });
});
