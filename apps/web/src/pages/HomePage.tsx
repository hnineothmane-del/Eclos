import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProductIdentity } from '../config/identity';
import { ambientTurn, chatTurn, ensureSession, acceptChallenge, startChallenge, attemptChallenge, declineChallenge, submitEvidence, checkJudgment, getGroundedProcessInsight, rivalInteraction } from '../lib/api';
import type { Challenge, PresenceDecision, PresenceInteraction } from '@ai-rival/domain';
import { RivalLens } from '../components/RivalLens';
import { RivalPresence } from '../components/RivalPresence';
import { useRivalPresence } from '../components/useRivalPresence';
import { getCaptureProfile } from '../lib/captureProfile';
import '../styles/home.css';

type FlowState = 
  | 'ENTRY' 
  | 'LOADING' 
  | 'RIVAL_RESPONSE' 
  | 'CHALLENGE_PRESENTED' 
  | 'CHALLENGE_ACTIVE' 
  | 'SUBMITTING_PROOF' 
  | 'JUDGMENT' 
  | 'ACCOUNT_PRESERVATION'
  | 'ERROR';

type RivalResponse = { response?: string; seriousFlag?: boolean };
type UiChallenge = Partial<Challenge> & Pick<Challenge, 'id' | 'status'> & { title?: string; parameters?: { domain?: string } };
type Judgment = { verdict: string; feedback?: string; respect_delta: number };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something broke.';
}

export const HomePage: React.FC = () => {
  const [flow, setFlow] = useState<FlowState>('ENTRY');
  const [userInput, setUserInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // State for response
  const [response, setResponse] = useState<RivalResponse | null>(null);
  
  // State for challenge
  const [activeChallenge, setActiveChallenge] = useState<UiChallenge | null>(null);
  const [proofText, setProofText] = useState('');
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [groundedInsight, setGroundedInsight] = useState<string | null>(null);
  const [ambientMessage, setAmbientMessage] = useState<string | null>(null);
  const [caught, setCaught] = useState(false);
  const flowRef = useRef(flow);
  const activeChallengeRef = useRef(activeChallenge);
  const seriousRef = useRef(false);
  flowRef.current = flow;
  activeChallengeRef.current = activeChallenge;
  seriousRef.current = Boolean(response?.seriousFlag);

  useEffect(() => {
    if (!caught) return;
    const timeout = window.setTimeout(() => setCaught(false), 500);
    return () => window.clearTimeout(timeout);
  }, [caught]);

  const handleAmbientEvent = useCallback(async (presenceDecision: PresenceDecision) => {
    const status = activeChallengeRef.current?.status;
    const challengeCritical = status === 'evidence_submitted' || status === 'needs_more_evidence';
    if (challengeCritical || seriousRef.current || flowRef.current === 'SUBMITTING_PROOF' || flowRef.current === 'JUDGMENT') return;
    try {
      const result = await ambientTurn(presenceDecision);
      if (typeof result?.response === 'string' && result.response.trim()) setAmbientMessage(result.response);
    } catch {
      // Ambient presence is deliberately non-blocking. A failed aside must not
      // interrupt the challenge or replace the user's current screen.
    }
  }, []);
  const handlePresenceInteraction = useCallback(async (interaction: PresenceInteraction, presenceDecision: PresenceDecision) => {
    try {
      const result = await rivalInteraction(interaction, presenceDecision);
      if (result?.easterEgg?.visualCue === 'caught') setCaught(true);
      if (typeof result?.response === 'string' && result.response.trim()) setAmbientMessage(result.response);
    } catch {
      // An optional interaction never blocks the current work flow.
    }
  }, []);
  const rivalPresence = useRivalPresence({
    activeChallenge: activeChallenge as Challenge | null,
    serious: Boolean(response?.seriousFlag),
    onAmbientEvent: handleAmbientEvent,
    onPresenceInteraction: handlePresenceInteraction,
  });

  // Quick preset goals
  const presetGoals = [
    'Get better at coding',
    'Get in shape',
    'Study consistently'
  ];

  const standingFor = (verdict: string, delta: number) => {
    if (verdict === 'passed' && delta > 0) return 'Suspiciously competent';
    if (verdict === 'failed') return 'Still under review';
    if (verdict === 'needs_more_evidence') return 'Unconvinced—for now';
    return 'Being watched';
  };

  const handleGoalSubmit = async (goal: string) => {
    try {
      rivalPresence.markMeaningfulActivity();
      setFlow('LOADING');
      await ensureSession();
      
      const turnResult = await chatTurn(goal);
      setResponse(turnResult as RivalResponse);
      
      if (turnResult.challenge) {
        setActiveChallenge(turnResult.challenge as UiChallenge);
        setFlow('CHALLENGE_PRESENTED');
      } else {
        setFlow('RIVAL_RESPONSE');
      }
    } catch (error: unknown) {
      setErrorMsg(messageFor(error));
      setFlow('ERROR');
    }
  };

  const handleAccept = async () => {
    if (!activeChallenge) return;
    try {
      rivalPresence.markMeaningfulActivity();
      setFlow('LOADING');
      const updated = await acceptChallenge(activeChallenge.id);
      setActiveChallenge(updated);
      setFlow('CHALLENGE_ACTIVE');
    } catch (error: unknown) {
      setErrorMsg(messageFor(error));
      setFlow('ERROR');
    }
  };

  const handleDecline = async () => {
    if (!activeChallenge) return;
    try {
      rivalPresence.markMeaningfulActivity();
      setFlow('LOADING');
      await declineChallenge(activeChallenge.id);
      setActiveChallenge(null);
      setFlow('RIVAL_RESPONSE');
    } catch (error: unknown) {
      setErrorMsg(messageFor(error));
      setFlow('ERROR');
    }
  };

  const handleSubmitProof = async () => {
    if (!proofText.trim() || !activeChallenge) return;
    try {
      rivalPresence.markMeaningfulActivity();
      setFlow('LOADING');
      const result = await submitEvidence(activeChallenge.id, proofText);
      setActiveChallenge(result.challenge as UiChallenge);
      setFlow('SUBMITTING_PROOF');
      
      // Polling for judgment
      let isJudging = true;
      let errorCount = 0;
      
      const pollJudgment = async () => {
        while (isJudging) {
          try {
            const j = await checkJudgment(activeChallenge.id);
            if (j) {
              isJudging = false;
              setJudgment(j as Judgment);
              try {
                setGroundedInsight(await getGroundedProcessInsight(activeChallenge as Challenge));
              } catch {
                setGroundedInsight(null);
              }
              setFlow('JUDGMENT');
              return;
            }
            errorCount = 0; // reset on success
          } catch (e) {
            errorCount++;
            if (errorCount > 3) {
              isJudging = false;
              setErrorMsg('Failed to check judgment status. Please refresh.');
              setFlow('ERROR');
              return;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      };
      
      pollJudgment();
      
    } catch (error: unknown) {
      setErrorMsg(messageFor(error));
      setFlow('ERROR');
    }
  };

  const renderVisualAnchor = () => (
    <>
      <div className="rival-anchor" aria-label={`${ProductIdentity.characterName} is present`}>
        <span className="rival-symbol" aria-hidden="true">{ProductIdentity.characterVisual}</span>
        <div className="rival-identity">
          <span className="eyebrow">{ProductIdentity.appName}</span>
          <strong>{ProductIdentity.characterName}</strong>
        </div>
      </div>
      <RivalPresence
        visual={rivalPresence.visual}
        caught={caught}
        onPresenceInteraction={rivalPresence.recordInteraction}
      />
      {ambientMessage && (
        <section className="ambient-rival-message" aria-label="Rival ambient remark" aria-live="polite">
          <p className="section-label">RIVAL</p>
          <p>“{ambientMessage}”</p>
          <button type="button" className="ambient-rival-dismiss" onClick={() => setAmbientMessage(null)}>Dismiss</button>
        </section>
      )}
    </>
  );

  return (
    <div className="layout-container">
      {renderVisualAnchor()}

      {flow === 'ENTRY' && (
        <div className="step-container">
          <h1 className="rival-text">"So.<br/>What are we proving?"</h1>
          <p className="entry-copy">Make a claim. Your Rival gives you something small enough to do now—and remembers whether you do it.</p>
          <p className="section-label">PICK A QUICK CLAIM</p>
          <div className="preset-goals">
            {presetGoals.map(g => (
              <button key={g} className="btn-preset" onClick={() => handleGoalSubmit(g)}>{g}</button>
            ))}
          </div>
          <div className="custom-input-group">
            <input 
              type="text" 
              className="input-custom" 
              placeholder="Or make your own claim..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && userInput.trim() && handleGoalSubmit(userInput)}
            />
            <button className="btn-primary" onClick={() => userInput.trim() && handleGoalSubmit(userInput)}>
              Make the claim
            </button>
          </div>
        </div>
      )}

      {flow === 'LOADING' && (
        <div className="step-container">
          <p className="loading-text" aria-live="polite">One moment.</p>
        </div>
      )}

      {flow === 'RIVAL_RESPONSE' && response && (
        <div className="step-container">
          <p className="section-label">RIVAL</p>
          <h2 className="rival-text rival-response">"{response.response}"</h2>
          <div className="input-bar">
            <input 
              type="text" 
              className="input-custom" 
              placeholder="Reply..." 
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && userInput.trim() && handleGoalSubmit(userInput)}
            />
            <button className="btn-primary" onClick={() => userInput.trim() && handleGoalSubmit(userInput)}>Send</button>
          </div>
        </div>
      )}

      {flow === 'CHALLENGE_PRESENTED' && activeChallenge && (
        <div className="step-container">
          {response && <><p className="section-label">RIVAL</p><h2 className="rival-text rival-response">"{response.response}"</h2></>}
          <div className="challenge-card">
            <h3>PROVE IT</h3>
            <p className="challenge-intro">Small enough to start. Specific enough to count.</p>
            <div className="challenge-details">
              <p><strong>Objective:</strong> {activeChallenge.objective || activeChallenge.title}</p>
              <p><strong>Pressure:</strong> {activeChallenge.difficulty}</p>
              <p><strong>Proof:</strong> Required</p>
            </div>
            <div className="challenge-actions">
              <button className="btn-primary" onClick={handleAccept}>ACCEPT</button>
              <button className="btn-secondary" aria-label="Negotiate this challenge in a future turn">NEGOTIATE</button>
              <button className="btn-subtle" onClick={handleDecline}>DECLINE</button>
            </div>
          </div>
        </div>
      )}

      {flow === 'CHALLENGE_ACTIVE' && activeChallenge && (
        <div className="step-container">
          <div className="challenge-card active">
            <h3>ACTIVE CHALLENGE</h3>
            <p className="objective">{activeChallenge.objective || activeChallenge.title}</p>
            <p className="hint">Work first. Leave a thought if you want. Proof is what settles it.</p>

            {activeChallenge.status === 'accepted' && (
              <button className="btn-primary full-width" onClick={async () => {
                setFlow('LOADING');
                try {
                  const data = await startChallenge(activeChallenge.id);
                  setActiveChallenge(data);
                  setFlow('CHALLENGE_ACTIVE');
                } catch (e) {
                  setErrorMsg(messageFor(e));
                  setFlow('ERROR');
                }
              }}>START WORK</button>
            )}

            {activeChallenge.status === 'started' && (
              <button className="btn-primary full-width" onClick={async () => {
                setFlow('LOADING');
                try {
                  const data = await attemptChallenge(activeChallenge.id);
                  setActiveChallenge(data);
                  setFlow('CHALLENGE_ACTIVE');
                } catch (e) {
                  setErrorMsg(messageFor(e));
                  setFlow('ERROR');
                }
              }}>LOG ATTEMPT</button>
            )}

            {(activeChallenge.status === 'attempted' || activeChallenge.status === 'evidence_submitted' || activeChallenge.status === 'needs_more_evidence') && (
              <>
                <RivalLens
                  challengeId={activeChallenge.id}
                  profile={getCaptureProfile(activeChallenge.parameters?.domain || 'general')}
                />
                
                <textarea 
                  className="proof-input" 
                  placeholder="Submit your proof here..."
                  value={proofText}
                  onChange={e => setProofText(e.target.value)}
                />
                <button className="btn-primary full-width" onClick={handleSubmitProof}>SUBMIT PROOF</button>
              </>
            )}
          </div>
        </div>
      )}

      {flow === 'SUBMITTING_PROOF' && (
        <div className="step-container">
          <p className="loading-text">Judging evidence...</p>
        </div>
      )}

      {flow === 'JUDGMENT' && judgment && (
        <div className="step-container">
          <div className="judgment-card">
            <p className="section-label">VERDICT</p>
            <h2 className={`verdict ${judgment.verdict}`}>{judgment.verdict.toUpperCase()}</h2>
            <h3 className="rival-text">"{judgment.feedback || '...okay.'}"</h3>
            {groundedInsight && (
              <div className="judgment-observation">
                <p className="section-label">OBSERVATION</p>
                <p>{groundedInsight}</p>
              </div>
            )}
            <div className="relationship-delta" aria-label="Relationship consequence">
              <p className="section-label">RIVAL STANDING</p>
              <strong>{standingFor(judgment.verdict, judgment.respect_delta)}</strong>
              <span>Respect {judgment.respect_delta >= 0 ? '+' : ''}{judgment.respect_delta}</span>
            </div>
            <p className="next-action">Keep the record. The next challenge has more to work with.</p>
            <button className="btn-primary" onClick={() => setFlow('ACCOUNT_PRESERVATION')}>Continue</button>
          </div>
        </div>
      )}

      {flow === 'ACCOUNT_PRESERVATION' && (
        <div className="step-container preservation">
          <h2 className="rival-text">"You have a Rival now."</h2>
          <p>Keep the record?</p>
          <p className="subtext">Preserve what happened here—your proof, the Rival&apos;s judgment, and what it learns to notice next time.</p>
          
          <div className="preservation-actions">
            <button className="btn-primary">Preserve Account</button>
            <button className="btn-subtle">Continue as Guest</button>
          </div>
        </div>
      )}

      {flow === 'ERROR' && (
        <div className="step-container error-container">
          <h2 className="rival-text">"Something broke."</h2>
          <p className="rival-text subtext">"For once, this wasn't you."</p>
          <p className="error-details">{errorMsg}</p>
          <button className="btn-primary" onClick={() => setFlow('ENTRY')}>Start Over</button>
        </div>
      )}
    </div>
  );
};
