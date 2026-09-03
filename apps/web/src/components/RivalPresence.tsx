import type { PresenceInteraction, PresenceVisualState } from '@ai-rival/domain';
import { ProductIdentity } from '../config/identity';

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
  caught?: boolean;
  /** An intentionally small extension point; no interaction mechanics are implemented here. */
  onPresenceInteraction?: (interaction: PresenceInteraction) => void;
}

/**
 * A persistent, deliberately restrained presence marker. It exposes state in
 * the interface without pretending a visual transition is a generated chat turn.
 */
export function RivalPresence({ visual, caught = false, onPresenceInteraction }: RivalPresenceProps) {
  const label = labelForState[visual.state] || labelForActivity[visual.activity];

  return (
    <div className="rival-presence" data-presence-state={visual.state} data-presence-activity={visual.activity} data-presence-animation={visual.animationHint} data-presence-intensity={visual.intensity} data-presence-caught={caught || undefined}>
      <button type="button" className="rival-presence-glyph" aria-label="Get Rival's attention" onClick={() => onPresenceInteraction?.('tap')}>
        <span className="rival-presence-glyph-core" aria-hidden="true" />
      </button>
      <span className="rival-presence-copy">{ProductIdentity.characterName} is {label}</span>
      <span className="rival-presence-whisper" aria-hidden="true">{label}</span>
      {visual.canInteract && onPresenceInteraction && (
        <button
          type="button"
          className="rival-presence-wake"
          onClick={() => onPresenceInteraction('wake')}
        >
          Wake
        </button>
      )}
      {onPresenceInteraction && !visual.canInteract && (
        <button
          type="button"
          className="rival-presence-poke"
          onClick={() => onPresenceInteraction('poke')}
          aria-label="Poke Rival"
        >
          Poke
        </button>
      )}
    </div>
  );
}
