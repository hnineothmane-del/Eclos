import type { AIProvider } from './provider.js';
import { GeminiProvider } from './geminiProvider.js';

export interface ModelRouter {
  forChat(): AIProvider;
  forEvaluation(): AIProvider;
  forMultimodal(): AIProvider;
}

export interface ModelRouterConfig {
  apiKey?: string;
  cheapModel?: string;
  strongModel?: string;
  multimodalModel?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  customProviders?: {
    chat?: AIProvider;
    evaluation?: AIProvider;
    multimodal?: AIProvider;
  };
}

function getEnvVar(key: string): string {
  const globalEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return globalEnv?.[key] || '';
}

export class DefaultModelRouter implements ModelRouter {
  private readonly chatProvider: AIProvider;
  private readonly evaluationProvider: AIProvider;
  private readonly multimodalProvider: AIProvider;

  constructor(config: ModelRouterConfig = {}) {
    const apiKey = config.apiKey || getEnvVar('GEMINI_API_KEY');
    const cheapModel = config.cheapModel || getEnvVar('GEMINI_MODEL_CHEAP');
    const strongModel = config.strongModel || getEnvVar('GEMINI_MODEL_STRONG');
    const multimodalModel = config.multimodalModel || getEnvVar('GEMINI_MODEL_MULTIMODAL');

    this.chatProvider =
      config.customProviders?.chat ||
      new GeminiProvider({
        apiKey,
        model: cheapModel,
        baseUrl: config.baseUrl,
        fetchFn: config.fetchFn,
      });

    this.evaluationProvider =
      config.customProviders?.evaluation ||
      new GeminiProvider({
        apiKey,
        model: strongModel,
        baseUrl: config.baseUrl,
        fetchFn: config.fetchFn,
      });

    this.multimodalProvider =
      config.customProviders?.multimodal ||
      new GeminiProvider({
        apiKey,
        model: multimodalModel,
        baseUrl: config.baseUrl,
        fetchFn: config.fetchFn,
      });
  }

  forChat(): AIProvider {
    return this.chatProvider;
  }

  forEvaluation(): AIProvider {
    return this.evaluationProvider;
  }

  forMultimodal(): AIProvider {
    return this.multimodalProvider;
  }
}

/**
 * Factory function to create a ModelRouter.
 */
export function createModelRouter(config: ModelRouterConfig = {}): ModelRouter {
  return new DefaultModelRouter(config);
}
