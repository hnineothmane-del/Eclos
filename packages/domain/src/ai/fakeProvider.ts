import type {
  AIProvider,
  GenerateOptions,
  EvaluateOptions,
  AnalyzeMultimodalOptions,
  EvaluationResult,
  MultimodalAnalysisResult,
} from './provider.js';
import type { AIResponseContract } from '../types/aiContract.js';

export interface FakeAIProviderOptions {
  defaultGenerateResponse?: AIResponseContract;
  defaultEvaluationResult?: EvaluationResult;
  defaultMultimodalResult?: MultimodalAnalysisResult;
  errorToThrow?: Error;
}

export class FakeAIProvider implements AIProvider {
  public generateCalls: GenerateOptions[] = [];
  public evaluateCalls: EvaluateOptions[] = [];
  public analyzeMultimodalCalls: AnalyzeMultimodalOptions[] = [];

  private defaultGenerateResponse: AIResponseContract;
  private defaultEvaluationResult: EvaluationResult;
  private defaultMultimodalResult: MultimodalAnalysisResult;
  private errorToThrow?: Error;

  constructor(options: FakeAIProviderOptions = {}) {
    this.errorToThrow = options.errorToThrow;

    this.defaultGenerateResponse = options.defaultGenerateResponse ?? {
      response: 'You thought that was a PR? My grandma writes faster code while knitting.',
      intent: 'roast_and_challenge',
      humorMechanism: 'hyperbole',
      register: 'sarcastic',
      seriousFlag: false,
      eventSuggestions: [],
      memoryCandidates: [],
      observationCandidates: [],
    };

    this.defaultEvaluationResult = options.defaultEvaluationResult ?? {
      outcome: 'completed',
      confidence: 0.95,
      reasoning: 'Evidence meets all stated criteria decisively.',
    };

    this.defaultMultimodalResult = options.defaultMultimodalResult ?? {
      description: 'Image showing verified completion of the target exercise routine.',
      confidence: 0.9,
    };
  }

  setError(error?: Error): void {
    this.errorToThrow = error;
  }

  setGenerateResponse(response: AIResponseContract): void {
    this.defaultGenerateResponse = response;
  }

  setEvaluationResult(result: EvaluationResult): void {
    this.defaultEvaluationResult = result;
  }

  setMultimodalResult(result: MultimodalAnalysisResult): void {
    this.defaultMultimodalResult = result;
  }

  async generate(options: GenerateOptions): Promise<AIResponseContract> {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    this.generateCalls.push(options);
    return { ...this.defaultGenerateResponse };
  }

  async evaluate(options: EvaluateOptions): Promise<EvaluationResult> {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    this.evaluateCalls.push(options);
    return { ...this.defaultEvaluationResult };
  }

  async analyzeMultimodal(options: AnalyzeMultimodalOptions): Promise<MultimodalAnalysisResult> {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    this.analyzeMultimodalCalls.push(options);
    return { ...this.defaultMultimodalResult };
  }
}
