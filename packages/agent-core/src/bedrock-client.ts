/**
 * Bedrock client wrapper - Claude inference via AWS Bedrock
 * Tier-based routing (starter -> haiku, others -> sonnet)
 * Retry with jittered backoff on throttling
 */

import type { Tier } from './tenant-context';

export interface BedrockInvokeParams {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface BedrockInvokeResponse {
  content: string;
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

interface ConverseRequestMessage {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
}

interface SystemContentBlock {
  type: 'text';
  text: string;
}

interface ConverseRequest {
  modelId: string;
  messages: ConverseRequestMessage[];
  system?: SystemContentBlock[];
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
}

interface ConverseResponse {
  output: {
    message: {
      content: Array<{ type: string; text: string }>;
    };
  };
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class BedrockClient {
  private modelId: string;
  private tier: Tier;
  private maxRetries: number;

  constructor(tier: Tier, modelIdOverride?: string) {
    this.tier = tier;
    this.maxRetries = 3;

    if (modelIdOverride) {
      this.modelId = modelIdOverride;
    } else {
      // Use inference profile for tier-based routing
      if (tier === 'starter') {
        this.modelId = process.env.BEDROCK_HAIKU_MODEL_ID || 'anthropic.claude-3-5-haiku-20241022-v1:0';
      } else {
        this.modelId = process.env.BEDROCK_SONNET_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v1:0';
      }
    }
  }

  /**
   * Invoke Bedrock Converse API with jittered backoff retry
   */
  async invoke(params: BedrockInvokeParams): Promise<BedrockInvokeResponse> {
    const converseRequest: ConverseRequest = {
      modelId: this.modelId,
      messages: params.messages.map(msg => ({
        role: msg.role,
        content: [{ type: 'text', text: msg.content }]
      })),
      ...(params.system && { system: [{ type: 'text', text: params.system }] }),
      inferenceConfig: {
        maxTokens: params.maxTokens ?? 1024,
        temperature: params.temperature ?? 0.7,
        topP: params.topP ?? 0.9
      }
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.callBedrockConverse(converseRequest);
        return response;
      } catch (error) {
        lastError = error as Error;

        // Check if throttled (429) or retryable
        const isThrottled = error instanceof BedrockThrottlingError;
        const isRetryable = isThrottled || (error instanceof Error && error.message.includes('ServiceUnavailable'));

        if (!isRetryable || attempt === this.maxRetries - 1) {
          throw error;
        }

        const backoffMs = this.getJitteredBackoff(attempt);
        await this.sleep(backoffMs);
      }
    }

    throw lastError || new Error('Bedrock invocation failed');
  }

  /**
   * Call Bedrock Converse API
   * In production, this would use AWS SDK; for now, mock for testing
   */
  private async callBedrockConverse(request: ConverseRequest): Promise<BedrockInvokeResponse> {
    // Simulate Bedrock API call
    // In production: new BedrockRuntimeClient().converse(request)
    const response: ConverseResponse = {
      output: {
        message: {
          content: [{ type: 'text', text: 'Mock response' }]
        }
      },
      stopReason: 'end_turn',
      usage: {
        inputTokens: 100,
        outputTokens: 50
      }
    };

    const content = response.output.message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected Bedrock response format');
    }

    return {
      content: content.text,
      stopReason: response.stopReason,
      usage: response.usage
    };
  }

  /**
   * Exponential backoff with jitter: (2^attempt * 100ms) + random(0-100ms)
   */
  private getJitteredBackoff(attempt: number): number {
    const baseMs = Math.pow(2, attempt) * 100;
    const jitterMs = Math.random() * 100;
    return baseMs + jitterMs;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Error thrown when Bedrock throttles a request (429)
 */
export class BedrockThrottlingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BedrockThrottlingError';
  }
}
