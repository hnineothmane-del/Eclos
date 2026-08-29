import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider } from './geminiProvider.js';
import {
  AuthenticationError,
  InvalidStructuredOutputError,
  ProviderUnavailableError,
  RateLimitError,
  UpstreamRequestError,
} from './errors.js';

describe('GeminiProvider', () => {
  it('throws AuthenticationError if apiKey is missing or empty', () => {
    expect(() => new GeminiProvider({ apiKey: '', model: 'gemini-2.5-flash' })).toThrow(
      AuthenticationError,
    );
  });

  it('throws UpstreamRequestError if model is missing or empty', () => {
    expect(() => new GeminiProvider({ apiKey: 'valid-key', model: '' })).toThrow(
      UpstreamRequestError,
    );
  });

  describe('generate', () => {
    it('sends correct request and normalizes structured response', async () => {
      const mockPayload = {
        response: 'Nice try, but you skipped leg day.',
        intent: 'mockery',
        humorMechanism: 'teasing',
        register: 'informal',
        seriousFlag: false,
        eventSuggestions: [
          {
            suggestedEventType: 'challenge_failed',
            suggestedPayload: { reason: 'skipped_workout' },
            confidence: 0.8,
          },
        ],
        memoryCandidates: [
          {
            tier: 'decaying',
            category: 'observation',
            key: 'leg_day_avoidance',
            value: 'Skipped legs again',
            confidence: 0.9,
          },
        ],
        observationCandidates: [
          {
            category: 'persistence',
            observation: 'Avoids lower body training',
            valence: 'negative',
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify(mockPayload),
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'secret-key-123',
        model: 'models/gemini-2.5-flash',
        fetchFn: mockFetch,
      });

      const result = await provider.generate({
        prompt: 'User completed half the workout',
        systemPrompt: 'You are an abrasive rival',
        temperature: 0.7,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, requestInit] = mockFetch.mock.calls[0];
      expect(url).toContain('/interactions');
      expect(requestInit.headers['x-goog-api-key']).toBe('secret-key-123');

      const body = JSON.parse(requestInit.body);
      expect(body.model).toBe('models/gemini-2.5-flash');
      expect(body.input).toBe('User completed half the workout');
      expect(body.system_instruction).toBe('You are an abrasive rival');
      expect(body.generation_config.response_mime_type).toBe('application/json');

      expect(result.response).toBe('Nice try, but you skipped leg day.');
      expect(result.intent).toBe('mockery');
      expect(result.memoryCandidates).toHaveLength(1);
      expect(result.observationCandidates).toHaveLength(1);
    });

    it('throws InvalidStructuredOutputError on malformed JSON payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          output_text: 'NOT_VALID_JSON',
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(
        InvalidStructuredOutputError,
      );
    });

    it('throws InvalidStructuredOutputError when output_text is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: { foo: 'bar' } }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(
        InvalidStructuredOutputError,
      );
    });

    it('throws InvalidStructuredOutputError on unexpected response shape', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ text: 'not allowed by the project contract' }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(
        InvalidStructuredOutputError,
      );
    });

    it('throws InvalidStructuredOutputError on missing required fields', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify({ wrongField: 'value' }),
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(
        InvalidStructuredOutputError,
      );
    });
  });

  describe('evaluate', () => {
    it('evaluates challenge evidence and returns validated EvaluationResult', async () => {
      const mockPayload = {
        outcome: 'completed',
        confidence: 0.92,
        reasoning: 'Provided photo shows complete adherence to constraints.',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify(mockPayload),
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      const result = await provider.evaluate({
        challengeObjective: 'Run 5km under 25 minutes',
        constraints: ['No walking'],
        evidenceKind: 'image',
        evidenceContent: 'strava_proof.png',
      });

      expect(result.outcome).toBe('completed');
      expect(result.confidence).toBe(0.92);
      expect(result.reasoning).toContain('complete adherence');
    });
  });

  describe('analyzeMultimodal', () => {
    it('analyzes image evidence correctly', async () => {
      const mockPayload = {
        description: 'A screenshot showing 5.2 km run at 4:45 min/km pace.',
        confidence: 0.95,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify(mockPayload),
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      const result = await provider.analyzeMultimodal({
        mediaType: 'image/jpeg',
        mediaBase64: 'BASE64_DATA',
        prompt: 'Verify the running distance',
      });

      expect(result.description).toContain('5.2 km');
      expect(result.confidence).toBe(0.95);
    });
  });

  describe('HTTP error handling & security', () => {
    it('throws AuthenticationError on 401 without exposing raw secret in error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({
          error: { message: 'API key secret-12345 is invalid' },
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'secret-12345',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(AuthenticationError);

      try {
        await provider.generate({ prompt: 'test' });
      } catch (error) {
        const message = String(error);
        expect(message).not.toContain('secret-12345');
        expect(message).toContain('Authentication');
      }
    });

    it('sanitizes Authorization headers and preserves safe details', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ Authorization: 'Bearer secret-token-xyz' }),
        json: async () => ({ error: { message: 'Authorization: Bearer secret-token-xyz is invalid' } }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'secret-token-xyz',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      try {
        await provider.generate({ prompt: 'test' });
      } catch (error) {
        const message = String(error);
        expect(message).not.toContain('secret-token-xyz');
        expect(message).not.toContain('Authorization');
        expect(message).toContain('401');
      }
    });

    it('rejects invalid 0-1 confidence values', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify({
            response: 'ok',
            intent: 'test',
            eventSuggestions: [{ suggestedEventType: 'challenge_failed', suggestedPayload: { reason: 'x' }, confidence: 1.1 }],
          }),
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(InvalidStructuredOutputError);
    });

    it('throws RateLimitError on 429 with parsed retry-after', async () => {
      const headers = new Headers();
      headers.set('retry-after', '30');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers,
        json: async () => ({
          error: { message: 'Quota exceeded for model' },
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      try {
        await provider.generate({ prompt: 'test' });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterSeconds).toBe(30);
      }
    });

    it('throws ProviderUnavailableError on 503', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({
          error: { message: 'Service temporarily overloaded' },
        }),
      } as unknown as Response);

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(ProviderUnavailableError);
    });

    it('throws ProviderUnavailableError on network connection failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const provider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-flash',
        fetchFn: mockFetch,
      });

      await expect(provider.generate({ prompt: 'test' })).rejects.toThrow(ProviderUnavailableError);
    });
  });
});
