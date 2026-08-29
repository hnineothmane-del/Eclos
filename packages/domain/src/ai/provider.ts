import type { AIResponseContract } from '../types/aiContract.js';

export interface EvaluationResult {
  outcome: 'completed' | 'failed' | 'needs_more_evidence';
  confidence: number;
  reasoning: string;
}

export interface MultimodalAnalysisResult {
  description: string;
  confidence: number;
}

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface EvaluateOptions {
  challengeObjective: string;
  constraints?: string[];
  evidenceKind: string;
  evidenceContent: string;
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface AnalyzeMultimodalOptions {
  mediaType: string;
  mediaBase64: string;
  prompt?: string;
  systemPrompt?: string;
}

export interface AIProvider {
  /**
   * Generates advisory character dialogue, intent, and candidates.
   */
  generate(options: GenerateOptions): Promise<AIResponseContract>;

  /**
   * Evaluates evidence submitted for a challenge.
   */
  evaluate(options: EvaluateOptions): Promise<EvaluationResult>;

  /**
   * Analyzes an image or other multimodal submission.
   */
  analyzeMultimodal(options: AnalyzeMultimodalOptions): Promise<MultimodalAnalysisResult>;
}
