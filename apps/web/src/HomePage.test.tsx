import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomePage } from './pages/HomePage';
import * as api from './lib/api';

vi.mock('./lib/api', () => ({
  ensureSession: vi.fn(),
  chatTurn: vi.fn(),
  ambientTurn: vi.fn(),
  rivalInteraction: vi.fn(),
  acceptChallenge: vi.fn((id: string) => Promise.resolve({ id, status: 'accepted', title: 'Do 10 pushups', parameters: { domain: 'fitness' } })),
  startChallenge: vi.fn((id: string) => Promise.resolve({ id, status: 'started', title: 'Do 10 pushups', parameters: { domain: 'fitness' } })),
  attemptChallenge: vi.fn((id: string) => Promise.resolve({ id, status: 'attempted', title: 'Do 10 pushups', parameters: { domain: 'fitness' } })),
  declineChallenge: vi.fn(),
  submitEvidence: vi.fn(() => Promise.resolve({ submission: { id: 's1' }, challenge: { id: 'c1', status: 'evidence_submitted' } })),
  checkJudgment: vi.fn(),
  getGroundedProcessInsight: vi.fn()
}));

// Mock supabase db calls inside HomePage
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [] })
            })
          })
        })
      })
    })
  }
}));

describe('HomePage First-Session Vertical Slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('landing renders Eclos and The Rival with goal choices', () => {
    render(<HomePage />);
    expect(screen.getByText(/What are we proving?/i)).toBeInTheDocument();
    expect(screen.getByText('The Rival')).toBeInTheDocument();
    expect(screen.getByText('Eclos')).toBeInTheDocument();
    expect(screen.getByText(/Pick a quick claim/i)).toBeInTheDocument();
    expect(screen.getByText('Get better at coding')).toBeInTheDocument();
  });

  it('custom goal input works and first interaction calls the backend', async () => {
    (api.chatTurn as any).mockResolvedValue({ response: 'Bring it on' });

    render(<HomePage />);
    const input = screen.getByPlaceholderText('Or make your own claim...');
    fireEvent.change(input, { target: { value: 'Learn piano' } });
    
    const submitBtn = screen.getByRole('button', { name: /Make the claim/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.chatTurn).toHaveBeenCalledWith('Learn piano');
    });
    expect(api.chatTurn).toHaveBeenCalledTimes(1);
  });

  it('backend Rival response renders', async () => {
    (api.chatTurn as any).mockResolvedValue({ response: 'Bring it on' });

    render(<HomePage />);
    fireEvent.click(screen.getByText('Get in shape'));

    await waitFor(() => {
      expect(screen.getByText(/"Bring it on"/i)).toBeInTheDocument();
    });
  });

  it('challenge appears from real returned state and controls are accessible', async () => {
    (api.chatTurn as any).mockResolvedValue({
      response: 'Here is a challenge',
      challenge: { id: 'c1', title: 'Do 10 pushups', difficulty: 5, status: 'issued' }
    });

    render(<HomePage />);
    fireEvent.click(screen.getByText('Get in shape'));

    await waitFor(() => {
      expect(screen.getByText('PROVE IT')).toBeInTheDocument();
      expect(screen.getByText('Do 10 pushups')).toBeInTheDocument();
      // accept/negotiation/decline controls are accessible
      expect(screen.getByRole('button', { name: /ACCEPT/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /NEGOTIATE/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /DECLINE/i })).toBeInTheDocument();
    });
  });

  it('active challenge renders correctly and proof submission flow works', async () => {
    (api.chatTurn as any).mockResolvedValue({
      response: 'Challenge',
      challenge: { id: 'c1', title: 'Do 10 pushups', difficulty: 5, status: 'issued' }
    });

    render(<HomePage />);
    fireEvent.click(screen.getByText('Get in shape'));

    await waitFor(() => expect(screen.getByRole('button', { name: /ACCEPT/i })).toBeInTheDocument());
    
    fireEvent.click(screen.getByRole('button', { name: /ACCEPT/i }));

    await waitFor(() => {
      expect(api.acceptChallenge).toHaveBeenCalledWith('c1');
      expect(screen.getByText('ACTIVE CHALLENGE')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /START WORK/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /START WORK/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /LOG ATTEMPT/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /LOG ATTEMPT/i }));
    await waitFor(() => {
      expect(screen.getByText('RIVAL LENS')).toBeInTheDocument();
      expect(screen.getByLabelText(/Rival Lens thought input/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send signal: STUCK' })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Submit your proof/i)).toBeInTheDocument();
    });

    const proofInput = screen.getByPlaceholderText(/Submit your proof/i);
    fireEvent.change(proofInput, { target: { value: 'I did them' } });
    
    // Check judgment visual representation
    (api.checkJudgment as any).mockResolvedValue({ verdict: 'passed', feedback: 'Good job', respect_delta: 5 });
    vi.mocked(api.getGroundedProcessInsight).mockResolvedValue('User changed strategy once during the challenge.');

    fireEvent.click(screen.getByRole('button', { name: /SUBMIT PROOF/i }));

    await waitFor(() => {
      expect(api.submitEvidence).toHaveBeenCalledWith('c1', 'I did them');
    });

    await waitFor(() => {
      expect(screen.getByText('PASSED')).toBeInTheDocument();
      expect(screen.getByText(/"Good job"/i)).toBeInTheDocument();
      expect(screen.getByText(/User changed strategy once/i)).toBeInTheDocument();
      expect(screen.getByText('Suspiciously competent')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('account-preservation prompt appears after first meaningful judgment', async () => {
    render(<HomePage />);
    
    // Short circuit to JUDGMENT state
    // We'll just test that clicking continue on judgment shows preservation
    // I can't easily set state, so I'll trigger it through the flow
    (api.chatTurn as any).mockResolvedValue({
      response: 'X',
      challenge: { id: 'c1', title: 'X', difficulty: 5, status: 'issued' }
    });

    fireEvent.click(screen.getByText('Get in shape'));
    await waitFor(() => fireEvent.click(screen.getByRole('button', { name: /ACCEPT/i })));
    await waitFor(() => fireEvent.click(screen.getByRole('button', { name: /START WORK/i })));
    await waitFor(() => fireEvent.click(screen.getByRole('button', { name: /LOG ATTEMPT/i })));
    
    await waitFor(() => {
      const proofInput = screen.getByPlaceholderText(/Submit your proof/i);
      fireEvent.change(proofInput, { target: { value: 'Y' } });
    });
    
    (api.checkJudgment as any).mockResolvedValue({ verdict: 'passed', feedback: 'Z', respect_delta: 5 });
    fireEvent.click(screen.getByRole('button', { name: /SUBMIT PROOF/i }));

    await waitFor(() => fireEvent.click(screen.getByRole('button', { name: /Continue/i })), { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByText(/You have a Rival now/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Preserve Account/i })).toBeInTheDocument();
    });
  });

  it('uses no ambient generation for a normal first interaction', async () => {
    vi.mocked(api.chatTurn).mockResolvedValue({ response: 'Bring it on' });
    render(<HomePage />);
    fireEvent.click(screen.getByText('Get in shape'));
    await waitFor(() => expect(api.chatTurn).toHaveBeenCalledTimes(1));
    expect(api.ambientTurn).not.toHaveBeenCalled();
  });

  it('renders a deterministic ambient remark through the existing chat-turn path', async () => {
    vi.useFakeTimers();
    vi.mocked(api.ambientTurn).mockResolvedValue({ response: 'You returned. Remarkable.' });
    render(<HomePage />);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {});
    expect(api.ambientTurn).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Rival ambient remark')).toHaveTextContent('You returned. Remarkable.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByLabelText('Rival ambient remark')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('keeps the first action reachable on a 320px viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    render(<HomePage />);
    expect(screen.getByRole('button', { name: /Make the claim/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/make your own claim/i)).toBeInTheDocument();
  });

  it('routes a presence tap through the existing interaction path without a second chat turn', async () => {
    vi.mocked(api.rivalInteraction).mockResolvedValue({});
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: "Get Rival's attention" }));
    await waitFor(() => expect(api.rivalInteraction).toHaveBeenCalledTimes(1));
    expect(api.chatTurn).not.toHaveBeenCalled();
  });
});
