import type { PresenceInteraction, PresenceVisualState } from '@ai-rival/domain';

const labelForActivity: Record<PresenceVisualState['activity'], string> = {
  idle: 'idle',
  watching: 'watching',
  thinking: 'thinking',
  resting: 'resting',
  sleeping: 'asleep',
  away: 'away',
  occupied: 'occupied',
  waiting: 'waiting',
  returning: 'returning',
};

const labelForState: Partial<Record<PresenceVisualState['state'], string>> = {
  idle: 'idle',
  bored: 'bored',
  awakening: 'waking',
  interrupting: 'paying attention',
  returning: 'back',
  serious: 'focused',
};

export interface RivalPresenceProps {
  visual: PresenceVisualState;
  /** An intentionally small extension point; no interaction mechanics are implemented here. */
  onPresenceInteraction?: (interaction: PresenceInteraction) => void;
}

/**
 * A persistent, deliberately restrained presence marker. It exposes state in
 * the interface without pretending a visual transition is a generated chat turn.
 */
export function RivalPresence({ visual, onPresenceInteraction }: RivalPresenceProps) {
  const label = labelForState[visual.state] || labelForActivity[visual.activity];

  return (
    <div className="rival-presence" data-presence-state={visual.state} data-presence-activity={visual.activity} data-presence-animation={visual.animationHint} data-presence-intensity={visual.intensity} aria-live="polite">
      <span className="rival-presence-glyph" aria-hidden="true" />
      <span className="rival-presence-copy">Rival is {label}</span>
      {visual.canInteract && onPresenceInteraction && (
        <button
          type="button"
          className="rival-presence-wake"
          onClick={() => onPresenceInteraction('wake')}
        >
          Wake
        </button>
      )}
    </div>
  );
}
