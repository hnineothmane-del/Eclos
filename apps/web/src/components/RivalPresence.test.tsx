import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Challenge, PresenceDecision, PresenceVisualState } from '@ai-rival/domain';
import { RivalPresence } from './RivalPresence';
import { useRivalPresence } from './useRivalPresence';

function PresenceHarness({ activeChallenge = null, serious = false, onAmbientEvent, onPresenceInteraction }: { activeChallenge?: Challenge | null; serious?: boolean; onAmbientEvent?: (decision: PresenceDecision) => void; onPresenceInteraction?: (interaction: 'touch' | 'tap' | 'poke' | 'wake' | 'interrupt' | 'user_roast' | 'user_challenge', decision: PresenceDecision) => void }) {
  const presence = useRivalPresence({ activeChallenge, serious, onAmbientEvent, onPresenceInteraction });
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
    expect(screen.getByText('The Rival is watching')).toBeInTheDocument();
    expect(screen.getByTestId('presence-state')).toHaveTextContent('active');
  });

  it('manifests an idle state without requesting an ambient event', () => {
    vi.useFakeTimers();
    render(<PresenceHarness />);
    act(() => vi.advanceTimersByTime(2 * 60 * 1000));
    expect(screen.getByText('The Rival is idle')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders sleeping and exposes the typed wake interaction', () => {
    const wake = vi.fn();
    render(<RivalPresence visual={sleepingVisual} onPresenceInteraction={wake} />);
    expect(screen.getByText('The Rival is asleep')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wake' }));
    expect(wake).toHaveBeenCalledWith('wake');
  });

  it('passes the pre-interaction presence snapshot to the existing interaction path', () => {
    const interaction = vi.fn();
    render(<PresenceHarness onPresenceInteraction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: "Get Rival's attention" }));
    expect(interaction).toHaveBeenCalledWith('tap', expect.objectContaining({ state: 'active', activity: 'watching' }));
  });

  it('exposes a separate poke interaction without inventing a new client decision', () => {
    const poke = vi.fn();
    render(<RivalPresence visual={{ ...sleepingVisual, state: 'observing', activity: 'watching', canInteract: false }} onPresenceInteraction={poke} />);
    fireEvent.click(screen.getByRole('button', { name: 'Poke Rival' }));
    expect(poke).toHaveBeenCalledWith('poke');
  });

  it('keeps the state label available to assistive technology while the glyph carries the visual presence', () => {
    render(<RivalPresence visual={sleepingVisual} />);
    expect(screen.getByText('The Rival is asleep')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Get Rival's attention" })).toHaveAttribute('class', 'rival-presence-glyph');
  });

  it('maps silent bored, resting, and returning states to visual behavior', () => {
    const { rerender } = render(<RivalPresence visual={{ ...sleepingVisual, state: 'bored', activity: 'waiting', animationHint: 'waiting', canInteract: false }} />);
    expect(screen.getByText('The Rival is bored')).toBeInTheDocument();
    rerender(<RivalPresence visual={{ ...sleepingVisual, state: 'resting', activity: 'resting', animationHint: 'resting' }} />);
    expect(screen.getByText('The Rival is resting')).toBeInTheDocument();
    rerender(<RivalPresence visual={{ ...sleepingVisual, state: 'returning', activity: 'returning', animationHint: 'returning', canInteract: false }} />);
    expect(screen.getByText('The Rival is back')).toBeInTheDocument();
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

  it('surfaces one rare life opportunity after quiet boredom and does not request prose for sleep', () => {
    vi.useFakeTimers();
    const ambient = vi.fn();
    render(<PresenceHarness onAmbientEvent={ambient} />);
    act(() => vi.advanceTimersByTime(18 * 60 * 1000));
    expect(ambient).toHaveBeenCalledTimes(1);
    expect(ambient.mock.calls[0][0]).toMatchObject({ action: 'rare_character_event', state: 'bored' });

    // A fresh runtime that reaches sleep changes only visual state; it does not
    // create an ambient network/generation request for sleep_start.
    ambient.mockClear();
    act(() => vi.advanceTimersByTime(12 * 60 * 1000));
    expect(ambient).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
