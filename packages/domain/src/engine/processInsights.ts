import type { Challenge } from '../types/challenge.js';
import type { DomainEvent } from '../types/events.js';

export type InsightType =
  | 'initialization_delay'
  | 'stall_then_recovery'
  | 'strategy_switch'
  | 'repeated_strategy_switch'
  | 'confidence_before_attempt'
  | 'confidence_after_failure'
  | 'help_seeking'
  | 'persistence_after_failure'
  | 'early_abandonment'
  | 'rapid_recovery'
  | 'successful_under_time_pressure'
  | 'difficulty_after_negotiation';

export interface ProcessInsight {
  type: InsightType;
  challengeId: string;
  sourceEventIds: string[];
  description: string;
  confidence: number;
}

const CONFIDENCE_WORDS = ['i know this', 'i got this', 'easy', 'simple', "i've got this"];

export function deriveProcessInsights(
  challenge: Challenge,
  events: DomainEvent[]
): ProcessInsight[] {
  const insights: ProcessInsight[] = [];
  if (!challenge || !events || events.length === 0) return insights;

  const challengeEvents = events.filter(
    (e) =>
      ((e.payload as any)?.challenge_id === challenge.id || e.payload?.challengeId === challenge.id)
  ).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (challengeEvents.length === 0) return insights;

  // Process capture events and lifecycle events
  const signals = challengeEvents.filter(e => e.eventType === 'process_signal');
  const thoughts = challengeEvents.filter(e => e.eventType === 'process_thought');
  
  const startEvent = challengeEvents.find(e => e.eventType === 'challenge_started');
  const firstAction = challengeEvents.find(e => e.eventType === 'process_signal' || e.eventType === 'process_thought' || e.eventType === 'challenge_attempted' || e.eventType === 'evidence_submitted');
  const attempts = challengeEvents.filter(e => e.eventType === 'challenge_attempted' || e.eventType === 'evidence_submitted');
  const judgments = challengeEvents.filter(e => e.eventType === 'challenge_judged');
  
  const strategySwitches = signals.filter(s => (s.payload as any)?.signal === 'CHANGING APPROACH' || (s.payload as any)?.signal === 'CHANGING_APPROACH');
  const stuckSignals = signals.filter(s => (s.payload as any)?.signal === 'STUCK');
  const helpSignals = signals.filter(s => (s.payload as any)?.signal === 'NEED A HINT' || (s.payload as any)?.signal === 'NEED_HINT');
  
  const isCompleted = judgments.some(j => (j.payload as any)?.verdict === 'passed');
  const hasFailures = judgments.some(j => (j.payload as any)?.verdict === 'failed' || (j.payload as any)?.verdict === 'needs_more_evidence');
  
  const isAbandoned = challenge.status === 'closed' && !isCompleted;
  
  const firstAttempt = attempts[0];
  const confidenceThoughtsBeforeFirstAttempt = thoughts.filter(t => {
    const text = ((t.payload as any)?.content || '').toLowerCase();
    if (firstAttempt && new Date(t.createdAt) > new Date(firstAttempt.createdAt)) return false;
    return CONFIDENCE_WORDS.some(w => text.includes(w));
  });

  // initialization_delay
  if (startEvent && firstAction && startEvent.id !== firstAction.id) {
    const delayMs = new Date(firstAction.createdAt).getTime() - new Date(startEvent.createdAt).getTime();
    if (delayMs > 30000) {
      insights.push({
        type: 'initialization_delay',
        challengeId: challenge.id,
        sourceEventIds: [startEvent.id, firstAction.id],
        description: `User had a ${Math.floor(delayMs / 1000)}-second initiation delay.`,
        confidence: 0.9,
      });
    }
  }

  // strategy_switch & repeated_strategy_switch
  if (strategySwitches.length > 0) {
    if (strategySwitches.length >= 2) {
      insights.push({
        type: 'repeated_strategy_switch',
        challengeId: challenge.id,
        sourceEventIds: strategySwitches.map(s => s.id),
        description: `User changed strategy repeatedly (${strategySwitches.length} times) during the challenge.`,
        confidence: 0.95,
      });
    } else {
      insights.push({
        type: 'strategy_switch',
        challengeId: challenge.id,
        sourceEventIds: [strategySwitches[0].id],
        description: `User changed strategy once during the challenge.`,
        confidence: 0.9,
      });
    }
  }

  // stall_then_recovery
  if (stuckSignals.length > 0 && strategySwitches.length > 0 && isCompleted) {
    // Only if stall -> switch -> completion
    const firstStuck = stuckSignals[0];
    const laterSwitch = strategySwitches.find(s => new Date(s.createdAt) > new Date(firstStuck.createdAt));
    const completion = judgments.find(j => (j.payload as any)?.verdict === 'passed');
    if (laterSwitch && completion && new Date(completion.createdAt) > new Date(laterSwitch.createdAt)) {
      insights.push({
        type: 'stall_then_recovery',
        challengeId: challenge.id,
        sourceEventIds: [firstStuck.id, laterSwitch.id, completion.id],
        description: `User recovered after changing approach.`,
        confidence: 0.95,
      });
    }
  }

  // help_seeking
  if (helpSignals.length > 0) {
    insights.push({
      type: 'help_seeking',
      challengeId: challenge.id,
      sourceEventIds: helpSignals.map(s => s.id),
      description: `User requested assistance during the challenge.`,
      confidence: 0.9,
    });
  }

  // confidence_before_attempt
  if (confidenceThoughtsBeforeFirstAttempt.length > 0) {
    insights.push({
      type: 'confidence_before_attempt',
      challengeId: challenge.id,
      sourceEventIds: confidenceThoughtsBeforeFirstAttempt.map(t => t.id),
      description: `User expressed confidence before the attempt.`,
      confidence: 0.85,
    });
  }

  // confidence_after_failure
  const confidenceThoughtsAfterFailure = thoughts.filter(t => {
    const text = ((t.payload as any)?.content || '').toLowerCase();
    const isConfident = CONFIDENCE_WORDS.some(w => text.includes(w));
    if (!isConfident) return false;
    // was it after a failure but before next attempt/failure?
    const failedJudgment = judgments.find(j => 
      ((j.payload as any)?.verdict === 'failed' || (j.payload as any)?.verdict === 'needs_more_evidence') &&
      new Date(j.createdAt) < new Date(t.createdAt)
    );
    return !!failedJudgment;
  });

  if (confidenceThoughtsAfterFailure.length > 0) {
    // Check if subsequent attempt failed
    const thoughtTime = new Date(confidenceThoughtsAfterFailure[0].createdAt);
    const subsequentFailure = judgments.find(j => 
      new Date(j.createdAt) > thoughtTime &&
      ((j.payload as any)?.verdict === 'failed' || (j.payload as any)?.verdict === 'needs_more_evidence')
    );
    if (subsequentFailure) {
      insights.push({
        type: 'confidence_after_failure',
        challengeId: challenge.id,
        sourceEventIds: [confidenceThoughtsAfterFailure[0].id, subsequentFailure.id],
        description: `User expressed confidence before an unsuccessful result.`,
        confidence: 0.9,
      });
    }
  }

  // persistence_after_failure
  if (hasFailures && isCompleted) {
    const firstFailure = judgments.find(j => (j.payload as any)?.verdict === 'failed' || (j.payload as any)?.verdict === 'needs_more_evidence');
    const success = judgments.find(j => (j.payload as any)?.verdict === 'passed');
    if (firstFailure && success && new Date(success.createdAt) > new Date(firstFailure.createdAt)) {
      insights.push({
        type: 'persistence_after_failure',
        challengeId: challenge.id,
        sourceEventIds: [firstFailure.id, success.id],
        description: `User continued after an unsuccessful attempt and later succeeded.`,
        confidence: 0.9,
      });
    }
  }

  // early_abandonment
  if (isAbandoned) {
    // was there any attempt?
    if (attempts.length === 0) {
      const closedEvent = challengeEvents.find(e => e.eventType === 'challenge_closed');
      insights.push({
        type: 'early_abandonment',
        challengeId: challenge.id,
        sourceEventIds: closedEvent ? [closedEvent.id] : [],
        description: `User abandoned the challenge without making an attempt.`,
        confidence: 0.85,
      });
    }
  }

  // rapid_recovery
  if (hasFailures && isCompleted) {
    const firstFailure = judgments.find(j => (j.payload as any)?.verdict === 'failed' || (j.payload as any)?.verdict === 'needs_more_evidence');
    const success = judgments.find(j => (j.payload as any)?.verdict === 'passed');
    if (firstFailure && success && new Date(success.createdAt) > new Date(firstFailure.createdAt)) {
      const msDiff = new Date(success.createdAt).getTime() - new Date(firstFailure.createdAt).getTime();
      if (msDiff < 60000) { // within 1 minute
        insights.push({
          type: 'rapid_recovery',
          challengeId: challenge.id,
          sourceEventIds: [firstFailure.id, success.id],
          description: `User recovered and succeeded rapidly (in ${Math.floor(msDiff/1000)}s) after a failure.`,
          confidence: 0.9,
        });
      }
    }
  }

  // successful_under_time_pressure
  if (challenge.expectedDurationMinutes && isCompleted) {
    const success = judgments.find(j => (j.payload as any)?.verdict === 'passed');
    insights.push({
      type: 'successful_under_time_pressure',
      challengeId: challenge.id,
      sourceEventIds: success ? [success.id] : [],
      description: `User successfully completed the time-constrained challenge.`,
      confidence: 0.85,
    });
  }

  // difficulty_after_negotiation
  const negotiation = challengeEvents.find(e => e.eventType === 'challenge_negotiated');
  if (negotiation && isCompleted) {
    const success = judgments.find(j => (j.payload as any)?.verdict === 'passed');
    insights.push({
      type: 'difficulty_after_negotiation',
      challengeId: challenge.id,
      sourceEventIds: [negotiation.id, success!.id],
      description: `User succeeded after negotiating challenge parameters.`,
      confidence: 0.8,
    });
  } else if (negotiation && isAbandoned) {
    insights.push({
      type: 'difficulty_after_negotiation',
      challengeId: challenge.id,
      sourceEventIds: [negotiation.id],
      description: `User abandoned the challenge even after negotiating parameters.`,
      confidence: 0.85,
    });
  }

  return insights;
}
