import React, { useState, useRef } from 'react';
import type { CaptureProfile, ProcessCapture } from '../types/rivalLens';
import { recordProcessCapture } from '../lib/api';

// Rotating example thoughts — small fixed set, not model-generated
const EXAMPLE_THOUGHTS = [
  '"wait..."',
  '"I know this"',
  '"maybe I should just give up"',
  '"oh shit"',
  '"I fucked this up"',
];

export interface RivalLensProps {
  challengeId: string;
  profile: CaptureProfile;
  onCapture?: (capture: ProcessCapture) => void;
}

export const RivalLens: React.FC<RivalLensProps> = ({ challengeId, profile, onCapture }) => {
  const [thought, setThought] = useState('');
  const [recentSignal, setRecentSignal] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const exampleRef = useRef(Math.floor(Math.random() * EXAMPLE_THOUGHTS.length));

  const exampleThought = EXAMPLE_THOUGHTS[exampleRef.current];

  const handleSignal = async (signal: string) => {
    setRecentSignal(signal);
    const capture: ProcessCapture = {
      captureType: 'process_signal',
      signal,
      timestamp: new Date().toISOString(),
    };
    onCapture?.(capture);
    // Fire-and-forget: no AI call triggered
    void recordProcessCapture(challengeId, 'process_signal', { signal })
      .then(() => setCaptureError(false))
      .catch(() => setCaptureError(true));
    setTimeout(() => setRecentSignal(null), 2000);
  };

  const handleThoughtSubmit = async () => {
    const text = thought.trim();
    if (!text) return;
    const capture: ProcessCapture = {
      captureType: 'process_thought',
      content: text,
      timestamp: new Date().toISOString(),
    };
    onCapture?.(capture);
    void recordProcessCapture(challengeId, 'process_thought', { content: text })
      .then(() => setCaptureError(false))
      .catch(() => setCaptureError(true));
    setThought('');
  };

  return (
    <div className="rival-lens">
      <button
        className="rival-lens-toggle"
        onClick={() => setIsExpanded(e => !e)}
        aria-expanded={isExpanded}
      >
        <span className="lens-label">RIVAL LENS</span>
        <span className="lens-chevron">{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className="lens-body" aria-live="polite">
          <p className="lens-instructions">
            {profile.instructions} This is optional—just leave a trace if it helps.
          </p>
          <p className="lens-example">{exampleThought}</p>

          <div className="lens-signals">
            {profile.quickSignals.map(signal => (
              <button
                key={signal}
                className={`btn-signal ${recentSignal === signal ? 'active' : ''}`}
                onClick={() => handleSignal(signal)}
                aria-label={`Send signal: ${signal}`}
              >
                {signal}
              </button>
            ))}
          </div>

          {profile.allowedModalities.includes('text') && (
            <div className="lens-thought-input">
              <input
                type="text"
                className="input-custom"
                placeholder="Drop a thought..."
                value={thought}
                onChange={e => setThought(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleThoughtSubmit()}
                aria-label="Rival Lens thought input"
                maxLength={1000}
              />
              {thought.trim() && (
                <button className="btn-subtle lens-send" onClick={handleThoughtSubmit}>
                  Drop
                </button>
              )}
            </div>
          )}

          {recentSignal && (
            <p className="lens-sent" role="status" aria-live="assertive">
              Sent: {recentSignal}
            </p>
          )}
          {captureError && (
            <p className="lens-error" role="status">
              Couldn&apos;t save that capture. You can keep working.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
