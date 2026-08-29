import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomePage } from './pages/HomePage';
import * as api from './lib/api';

vi.mock('./lib/api', () => ({
  ensureSession: vi.fn(),
  chatTurn: vi.fn(),
  acceptChallenge: vi.fn(),
  declineChallenge: vi.fn(),
  submitEvidence: vi.fn(),
  checkJudgment: vi.fn()
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

  it('landing renders Rival and goal choices', () => {
    render(<HomePage />);
    expect(screen.getByText(/What are we proving?/i)).toBeInTheDocument();
    expect(screen.getByText('Get better at coding')).toBeInTheDocument();
  });

  it('custom goal input works and first interaction calls the backend', async () => {
    (api.chatTurn as any).mockResolvedValue({ response: 'Bring it on' });

    render(<HomePage />);
    const input = screen.getByPlaceholderText('I want to...');
    fireEvent.change(input, { target: { value: 'Learn piano' } });
    
    const submitBtn = screen.getByRole('button', { name: /Tell Rival/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.chatTurn).toHaveBeenCalledWith('Learn piano');
    });
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
    (api.chatTurn as any).mockResolvedValue({ response: 'Here is a challenge' });
    
    // Override supabase mock to return a challenge
    const { supabase } = await import('./lib/supabase');
    (supabase.from as any) = () => ({
      select: () => ({ eq: () => ({ in: () => ({ order: () => ({
        limit: () => Promise.resolve({ data: [{ id: 'c1', title: 'Do 10 pushups', difficulty: 5, status: 'issued' }] })
      }) }) }) })
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
    (api.chatTurn as any).mockResolvedValue({ response: 'Challenge' });
    const { supabase } = await import('./lib/supabase');
    (supabase.from as any) = () => ({
      select: () => ({ eq: () => ({ in: () => ({ order: () => ({
        limit: () => Promise.resolve({ data: [{ id: 'c1', title: 'Do 10 pushups', difficulty: 5, status: 'issued' }] })
      }) }) }) })
    });

    render(<HomePage />);
    fireEvent.click(screen.getByText('Get in shape'));

    await waitFor(() => expect(screen.getByRole('button', { name: /ACCEPT/i })).toBeInTheDocument());
    
    fireEvent.click(screen.getByRole('button', { name: /ACCEPT/i }));

    await waitFor(() => {
      expect(api.acceptChallenge).toHaveBeenCalledWith('c1');
      expect(screen.getByText('ACTIVE CHALLENGE')).toBeInTheDocument();
    });

    const proofInput = screen.getByPlaceholderText(/Submit your proof/i);
    fireEvent.change(proofInput, { target: { value: 'I did them' } });
    
    // Check judgment visual representation
    (api.checkJudgment as any).mockResolvedValue({ verdict: 'passed', feedback: 'Good job', respect_delta: 5 });

    fireEvent.click(screen.getByRole('button', { name: /SUBMIT PROOF/i }));

    await waitFor(() => {
      expect(api.submitEvidence).toHaveBeenCalledWith('c1', 'I did them');
    });

    await waitFor(() => {
      expect(screen.getByText('PASSED')).toBeInTheDocument();
      expect(screen.getByText(/"Good job"/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('account-preservation prompt appears after first meaningful judgment', async () => {
    render(<HomePage />);
    
    // Short circuit to JUDGMENT state
    // We'll just test that clicking continue on judgment shows preservation
    // I can't easily set state, so I'll trigger it through the flow
    (api.chatTurn as any).mockResolvedValue({});
    const { supabase } = await import('./lib/supabase');
    (supabase.from as any) = () => ({
      select: () => ({ eq: () => ({ in: () => ({ order: () => ({
        limit: () => Promise.resolve({ data: [{ id: 'c1', title: 'X', difficulty: 5, status: 'issued' }] })
      }) }) }) })
    });

    fireEvent.click(screen.getByText('Get in shape'));
    await waitFor(() => fireEvent.click(screen.getByRole('button', { name: /ACCEPT/i })));
    
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
});
