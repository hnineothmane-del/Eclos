import type {
  AIProvider,
  GenerateOptions,
  EvaluateOptions,
  AnalyzeMultimodalOptions,
  EvaluationResult,
  MultimodalAnalysisResult,
} from './provider.js';
import type { AIResponseContract } from '../types/aiContract.js';
import {
  AuthenticationError,
  InvalidStructuredOutputError,
  ProviderUnavailableError,
  RateLimitError,
  UpstreamRequestError,
} from './errors.js';
import {
  validateAIResponseContract,
  validateEvaluationResult,
  validateMultimodalAnalysisResult,
} from './validation.js';

export interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Strips markdown code blocks if the model wrapped the JSON output in ```json ... ```
 */
function cleanJsonOutput(text: string): string {
  const trimmed = text.trim();
  const jsonBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }
  return trimmed;
}

export class GeminiProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: GeminiProviderConfig) {
    if (!config.apiKey || typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new AuthenticationError('Gemini API key is required and must not be empty.');
    }
    if (!config.model || typeof config.model !== 'string' || !config.model.trim()) {
      throw new UpstreamRequestError('Gemini model name is required.');
    }

    this.apiKey = config.apiKey.trim();
    this.model = config.model.trim();
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.fetchFn = config.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (null as unknown as typeof fetch));

    if (!this.fetchFn) {
      throw new ProviderUnavailableError('No fetch implementation available in the current environment.');
    }
  }

  /**
   * Internal helper to execute a request against the Gemini API.
   */
  private async executeInteraction(payload: Record<string, unknown>): Promise<string> {
    const endpoint = `${this.baseUrl}/interactions`;

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network request failed';
      throw new ProviderUnavailableError(`Failed to connect to Gemini API: ${message}`);
    }

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch {
      throw new InvalidStructuredOutputError('Failed to parse Gemini response as JSON');
    }

    return this.extractOutputText(rawJson);
  }

  private async handleHttpError(response: Response): Promise<never> {
    let errorDetails = '';
    try {
      const errorJson = (await response.json()) as { error?: { message?: string } };
      if (errorJson?.error?.message) {
        // Redact any potential API key that might be in the error message
        errorDetails = errorJson.error.message.replace(/key=[^&\s]+/gi, 'key=[REDACTED]');
      }
    } catch {
      // Ignore body parse errors on HTTP failure
    }

    const status = response.status;

    if (status === 401 || status === 403) {
      throw new AuthenticationError(
        errorDetails ? `Authentication failed: ${errorDetails}` : 'Gemini API authentication failed (invalid or forbidden API key)',
      );
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      throw new RateLimitError(
        errorDetails ? `Rate limit exceeded: ${errorDetails}` : 'Gemini API rate limit exceeded',
        Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds,
      );
    }

    if (status >= 500) {
      throw new ProviderUnavailableError(
        errorDetails ? `Gemini service error (${status}): ${errorDetails}` : `Gemini service error (${status})`,
        status,
      );
    }

    throw new UpstreamRequestError(
      errorDetails ? `Gemini request rejected (${status}): ${errorDetails}` : `Gemini upstream error (${status})`,
      status,
    );
  }

  private extractOutputText(data: unknown): string {
    if (!data || typeof data !== 'object') {
      throw new InvalidStructuredOutputError('Received empty or non-object response from Gemini API');
    }

    const obj = data as Record<string, unknown>;

    // Interactions API response formats: output_text, output, outputs, or choices
    if (typeof obj.output_text === 'string') {
      return obj.output_text;
    }

    if (typeof obj.text === 'string') {
      return obj.text;
    }

    if (Array.isArray(obj.outputs) && obj.outputs.length > 0) {
      const first = obj.outputs[0] as Record<string, unknown>;
      if (typeof first.text === 'string') return first.text;
      if (first.content && typeof first.content === 'object') {
        const contentObj = first.content as Record<string, unknown>;
        if (typeof contentObj.text === 'string') return contentObj.text;
      }
    }

    if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
      const cand = obj.candidates[0] as Record<string, unknown>;
      const content = cand.content as Record<string, unknown> | undefined;
      if (Array.isArray(content?.parts) && content.parts.length > 0) {
        const part = content.parts[0] as Record<string, unknown>;
        if (typeof part.text === 'string') return part.text;
      }
    }

    if (typeof obj.output === 'string') {
      return obj.output;
    }

    if (typeof obj.output === 'object' && obj.output !== null) {
      return JSON.stringify(obj.output);
    }

    throw new InvalidStructuredOutputError(
      'Unable to locate valid text output in Gemini API response payload',
      JSON.stringify(data),
    );
  }

  async generate(options: GenerateOptions): Promise<AIResponseContract> {
    const payload: Record<string, unknown> = {
      model: this.model,
      input: options.prompt,
      generation_config: {
        response_mime_type: 'application/json',
        temperature: options.temperature,
        max_output_tokens: options.maxTokens,
      },
    };

    if (options.systemPrompt) {
      payload.system_instruction = options.systemPrompt;
    }

    const rawText = await this.executeInteraction(payload);
    const cleaned = cleanJsonOutput(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new InvalidStructuredOutputError('Failed to parse model output as JSON', rawText);
    }

    return validateAIResponseContract(parsed, rawText);
  }

  async evaluate(options: EvaluateOptions): Promise<EvaluationResult> {
    const systemPrompt = options.systemPrompt ||
      'You are a strict, impartial evaluator. Evaluate the submitted evidence against the challenge objective and constraints. Return JSON with fields: outcome ("completed" | "failed" | "needs_more_evidence"), confidence (0.0 to 1.0), and reasoning (string).';

    const promptText = `Challenge Objective: ${options.challengeObjective}
Constraints: ${JSON.stringify(options.constraints || [])}
Evidence Kind: ${options.evidenceKind}
Evidence Content: ${options.evidenceContent}
Metadata: ${JSON.stringify(options.metadata || {})}`;

    const payload: Record<string, unknown> = {
      model: this.model,
      system_instruction: systemPrompt,
      input: promptText,
      generation_config: {
        response_mime_type: 'application/json',
      },
    };

    const rawText = await this.executeInteraction(payload);
    const cleaned = cleanJsonOutput(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new InvalidStructuredOutputError('Failed to parse evaluation output as JSON', rawText);
    }

    return validateEvaluationResult(parsed, rawText);
  }

  async analyzeMultimodal(options: AnalyzeMultimodalOptions): Promise<MultimodalAnalysisResult> {
    const promptText = options.prompt || 'Analyze the provided image/multimodal evidence and describe what is shown.';

    const payload: Record<string, unknown> = {
      model: this.model,
      system_instruction: options.systemPrompt || 'You are an image analysis tool. Return JSON with fields: description (string) and confidence (number between 0.0 and 1.0).',
      input: [
        {
          inline_data: {
            mime_type: options.mediaType,
            data: options.mediaBase64,
          },
        },
        {
          text: promptText,
        },
      ],
      generation_config: {
        response_mime_type: 'application/json',
      },
    };

    const rawText = await this.executeInteraction(payload);
    const cleaned = cleanJsonOutput(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new InvalidStructuredOutputError('Failed to parse multimodal output as JSON', rawText);
    }

    return validateMultimodalAnalysisResult(parsed, rawText);
  }
}
