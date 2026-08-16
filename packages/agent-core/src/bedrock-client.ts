/**
 * Bedrock client wrapper - Claude inference via AWS Bedrock
 * Tier-based routing (starter -> haiku, others -> sonnet)
 * Retry with jittered backoff on throttling
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
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
  private bedrockClient: BedrockRuntimeClient;

  constructor(tier: Tier, modelIdOverride?: string) {
    this.tier = tier;
    this.maxRetries = 3;

    const region = process.env.AWS_REGION || 'us-east-1';
    this.bedrockClient = new BedrockRuntimeClient({ region });

    if (modelIdOverride) {
      this.modelId = modelIdOverride;
    } else {
      // Use cross-region inference profiles (us.anthropic.* format)
      if (tier === 'starter') {
        this.modelId = process.env.BEDROCK_HAIKU_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
      } else {
        this.modelId = process.env.BEDROCK_SONNET_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
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
        temperature: params.temperature ?? 0.7
        // Note: topP and temperature are mutually exclusive on Bedrock's Sonnet models
        // so we use temperature only and omit topP
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
   * Call Bedrock Converse API via AWS SDK
   */
  private async callBedrockConverse(request: ConverseRequest): Promise<BedrockInvokeResponse> {
    try {
      console.log('[BedrockClient] Calling Bedrock Converse with modelId:', request.modelId);
      console.log('[BedrockClient] AWS credentials present - ACCESS_KEY:', !!process.env.AWS_ACCESS_KEY_ID, 'SECRET_KEY:', !!process.env.AWS_SECRET_ACCESS_KEY);

      const command = new ConverseCommand({
        modelId: request.modelId,
        messages: request.messages as any,
        system: request.system,
        inferenceConfig: request.inferenceConfig
      });

      console.log('[BedrockClient] Sending command to Bedrock...');

      // Wrap send() with a 15-second timeout
      const sendPromise = this.bedrockClient.send(command);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bedrock call timed out after 15 seconds')), 15000)
      );

      const response = await Promise.race([sendPromise, timeoutPromise]);
      console.log('[BedrockClient] Bedrock responded successfully');

      // Extract text content from response
      if (!response.output?.message?.content?.[0]) {
        throw new Error('Bedrock returned empty response');
      }

      const contentBlock = response.output.message.content[0];

      // ContentBlock is a union; check for text type
      const textContent = (contentBlock as any)?.text;
      if (!textContent || typeof textContent !== 'string') {
        throw new Error('Unexpected Bedrock response format: expected text content');
      }

      return {
        content: textContent,
        stopReason: response.stopReason || 'end_turn',
        usage: response.usage ? {
          inputTokens: response.usage.inputTokens || 0,
          outputTokens: response.usage.outputTokens || 0
        } : { inputTokens: 0, outputTokens: 0 }
      };
    } catch (error) {
      console.error('[BedrockClient] Error calling Bedrock:', error instanceof Error ? error.message : String(error));
      // Check for throttling (429) / rate limit errors
      if (error instanceof Error) {
        if (error.name === 'ThrottlingException' || error.message.includes('rate')) {
          throw new BedrockThrottlingError(error.message);
        }
      }
      throw error;
    }
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
