import React, { useState } from 'react';
import { ProductIdentity } from '../config/identity';
import { chatTurn, ensureSession, acceptChallenge, declineChallenge, submitEvidence, checkJudgment } from '../lib/api';
import { supabase } from '../lib/supabase';
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

export const HomePage: React.FC = () => {
  const [flow, setFlow] = useState<FlowState>('ENTRY');
  const [userInput, setUserInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // State for response
  const [response, setResponse] = useState<any>(null);
  
  // State for challenge
  const [activeChallenge, setActiveChallenge] = useState<any>(null);
  const [proofText, setProofText] = useState('');
  const [judgment, setJudgment] = useState<any>(null);

  // Quick preset goals
  const presetGoals = [
    'Get better at coding',
    'Get in shape',
    'Study consistently'
  ];

  const handleGoalSubmit = async (goal: string) => {
    try {
      setFlow('LOADING');
      await ensureSession();
      
      const turnResult = await chatTurn(goal);
      setResponse(turnResult);
      
      // Check if a challenge was created (we can query the DB to see if there is an active one)
      const { data: { user } } = await supabase.auth.getUser();
      const { data: challenges } = await supabase
        .from('challenges')
        .select('*')
        .eq('user_id', user?.id)
        .in('status', ['issued'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (challenges && challenges.length > 0) {
        setActiveChallenge(challenges[0]);
        setFlow('CHALLENGE_PRESENTED');
      } else {
        setFlow('RIVAL_RESPONSE');
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Something broke.');
      setFlow('ERROR');
    }
  };

  const handleAccept = async () => {
    try {
      setFlow('LOADING');
      await acceptChallenge(activeChallenge.id);
      setFlow('CHALLENGE_ACTIVE');
    } catch (e: any) {
      setErrorMsg(e.message || 'Something broke.');
      setFlow('ERROR');
    }
  };

  const handleDecline = async () => {
    try {
      setFlow('LOADING');
      await declineChallenge(activeChallenge.id);
      setActiveChallenge(null);
      setFlow('RIVAL_RESPONSE');
    } catch (e: any) {
      setErrorMsg(e.message || 'Something broke.');
      setFlow('ERROR');
    }
  };

  const handleSubmitProof = async () => {
    if (!proofText.trim()) return;
    try {
      setFlow('LOADING');
      await submitEvidence(activeChallenge.id, proofText);
      setFlow('SUBMITTING_PROOF');
      
      // Polling for judgment (in a real app, this might be a webhook or realtime subscription, but we can poll for simplicity)
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const j = await checkJudgment(activeChallenge.id);
        if (j) {
          clearInterval(poll);
          setJudgment(j);
          setFlow('JUDGMENT');
        } else if (attempts > 15) { // Stop polling after a while
          clearInterval(poll);
          setErrorMsg('Judgment took too long.');
          setFlow('ERROR');
        }
      }, 2000);
      
    } catch (e: any) {
      setErrorMsg(e.message || 'Something broke.');
      setFlow('ERROR');
    }
  };

  const renderVisualAnchor = () => (
    <div className="rival-anchor">
      <span className="rival-symbol">{ProductIdentity.characterVisual}</span>
    </div>
  );

  return (
    <div className="layout-container">
      {renderVisualAnchor()}

      {flow === 'ENTRY' && (
        <div className="step-container">
          <h1 className="rival-text">"So.<br/>What are we proving?"</h1>
          <div className="preset-goals">
            {presetGoals.map(g => (
              <button key={g} className="btn-preset" onClick={() => handleGoalSubmit(g)}>{g}</button>
            ))}
          </div>
          <div className="custom-input-group">
            <input 
              type="text" 
              className="input-custom" 
              placeholder="I want to..." 
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && userInput.trim() && handleGoalSubmit(userInput)}
            />
            <button className="btn-primary" onClick={() => userInput.trim() && handleGoalSubmit(userInput)}>
              Tell {ProductIdentity.characterName}
            </button>
          </div>
        </div>
      )}

      {flow === 'LOADING' && (
        <div className="step-container">
          <p className="loading-text">Thinking...</p>
        </div>
      )}

      {flow === 'RIVAL_RESPONSE' && response && (
        <div className="step-container">
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
          {response && <h2 className="rival-text rival-response">"{response.response}"</h2>}
          <div className="challenge-card">
            <h3>PROVE IT</h3>
            <div className="challenge-details">
              <p><strong>Objective:</strong> {activeChallenge.title}</p>
              <p><strong>Difficulty:</strong> {activeChallenge.difficulty}/10</p>
              <p><strong>Proof:</strong> Required</p>
            </div>
            <div className="challenge-actions">
              <button className="btn-primary" onClick={handleAccept}>ACCEPT</button>
              <button className="btn-secondary">NEGOTIATE</button>
              <button className="btn-subtle" onClick={handleDecline}>DECLINE</button>
            </div>
          </div>
        </div>
      )}

      {flow === 'CHALLENGE_ACTIVE' && activeChallenge && (
        <div className="step-container">
          <div className="challenge-card active">
            <h3>ACTIVE CHALLENGE</h3>
            <p className="objective">{activeChallenge.title}</p>
            <p className="hint">You can tell me you're done. Proof is different.</p>
            
            <textarea 
              className="proof-input" 
              placeholder="Submit your proof here..."
              value={proofText}
              onChange={e => setProofText(e.target.value)}
            />
            <button className="btn-primary full-width" onClick={handleSubmitProof}>SUBMIT PROOF</button>
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
            <h2 className={`verdict ${judgment.verdict}`}>{judgment.verdict.toUpperCase()}</h2>
            <h3 className="rival-text">"{judgment.feedback || '...okay.'}"</h3>
            
            <div className="relationship-delta">
              <p>RESPECT {judgment.respect_delta >= 0 ? '+' : ''}{judgment.respect_delta}</p>
            </div>
            
            <button className="btn-primary" onClick={() => setFlow('ACCOUNT_PRESERVATION')}>Continue</button>
          </div>
        </div>
      )}

      {flow === 'ACCOUNT_PRESERVATION' && (
        <div className="step-container preservation">
          <h2 className="rival-text">"You have a Rival now."</h2>
          <p>Keep it?</p>
          <p className="subtext">Creating an account preserves your progress, respect, and history.</p>
          
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
