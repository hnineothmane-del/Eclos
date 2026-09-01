import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Challenge, PresenceDecision, PresenceVisualState } from '@ai-rival/domain';
import { RivalPresence } from './RivalPresence';
import { useRivalPresence } from './useRivalPresence';

function PresenceHarness({ activeChallenge = null, serious = false, onAmbientEvent }: { activeChallenge?: Challenge | null; serious?: boolean; onAmbientEvent?: (decision: PresenceDecision) => void }) {
  const presence = useRivalPresence({ activeChallenge, serious, onAmbientEvent });
  return (
    <>
      <RivalPresence visual={presence.visual} onPresenceInteraction={presence.recordInteraction} />
      <output data-testid="presence-state">{presence.decision.state}</output>
    </>
  );
}

describe('RivalPresence runtime', () => {
  const sleepingVisual: PresenceVisualState = { state: 'sleeping', activity: 'sleeping', attention: 'ignore', intensity: 1, animationHint: 'sleeping', canInteract: true, reason: 'long_idle' };
  it('renders the initial active manifestation', () => {
    render(<PresenceHarness />);
    expect(screen.getByText('Rival is watching')).toBeInTheDocument();
    expect(screen.getByTestId('presence-state')).toHaveTextContent('active');
  });

  it('manifests an idle state without requesting an ambient event', () => {
    vi.useFakeTimers();
    render(<PresenceHarness />);
    act(() => vi.advanceTimersByTime(2 * 60 * 1000));
    expect(screen.getByText('Rival is idle')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders sleeping and exposes the typed wake interaction', () => {
    const wake = vi.fn();
    render(<RivalPresence visual={sleepingVisual} onPresenceInteraction={wake} />);
    expect(screen.getByText('Rival is asleep')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wake' }));
    expect(wake).toHaveBeenCalledWith('wake');
  });

  it('maps silent bored, resting, and returning states to visual behavior', () => {
    const { rerender } = render(<RivalPresence visual={{ ...sleepingVisual, state: 'bored', activity: 'waiting', animationHint: 'waiting', canInteract: false }} />);
    expect(screen.getByText('Rival is bored')).toBeInTheDocument();
    rerender(<RivalPresence visual={{ ...sleepingVisual, state: 'resting', activity: 'resting', animationHint: 'resting' }} />);
    expect(screen.getByText('Rival is resting')).toBeInTheDocument();
    rerender(<RivalPresence visual={{ ...sleepingVisual, state: 'returning', activity: 'returning', animationHint: 'returning', canInteract: false }} />);
    expect(screen.getByText('Rival is back')).toBeInTheDocument();
  });

  it('produces one return event after a long visibility absence, not duplicate focus events', () => {
    vi.useFakeTimers();
    const ambient = vi.fn();
    render(<PresenceHarness onAmbientEvent={ambient} />);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(31 * 60 * 1000));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.focus(window);
    expect(ambient).toHaveBeenCalledTimes(1);
    expect(ambient.mock.calls[0][0].action).toBe('return_greeting');
    vi.useRealTimers();
  });

  it('suppresses ambient interruptions during challenge-critical and serious contexts', () => {
    vi.useFakeTimers();
    const ambient = vi.fn();
    const critical = { status: 'evidence_submitted' } as Challenge;
    const { rerender } = render(<PresenceHarness activeChallenge={critical} onAmbientEvent={ambient} />);
    act(() => vi.advanceTimersByTime(31 * 60 * 1000));
    expect(ambient).not.toHaveBeenCalled();
    rerender(<PresenceHarness serious onAmbientEvent={ambient} />);
    act(() => vi.advanceTimersByTime(31 * 60 * 1000));
    expect(ambient).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
