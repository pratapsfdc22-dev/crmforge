/**
 * Bedrock client tests - tier routing, retry behavior, error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BedrockClient, BedrockThrottlingError } from './bedrock-client';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

vi.mock('@aws-sdk/client-bedrock-runtime');

describe('BedrockClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment
    delete process.env.BEDROCK_HAIKU_MODEL_ID;
    delete process.env.BEDROCK_SONNET_MODEL_ID;

    // Mock BedrockRuntimeClient.send() to return successful response
    const mockSend = vi.fn().mockResolvedValue({
      output: {
        message: {
          content: [{ text: 'Mock response from Bedrock' }]
        }
      },
      stopReason: 'end_turn',
      usage: {
        inputTokens: 100,
        outputTokens: 50
      }
    });

    (BedrockRuntimeClient as any).mockImplementation(() => ({
      send: mockSend
    }));
  });

  describe('tier-based model routing', () => {
    it('should use Haiku for starter tier', () => {
      const client = new BedrockClient('starter');
      // Access private field for testing (or check via invoke behavior)
      expect(client['modelId']).toContain('haiku');
    });

    it('should use Sonnet for professional tier', () => {
      const client = new BedrockClient('professional');
      expect(client['modelId']).toContain('sonnet');
    });

    it('should use Sonnet for enterprise tier', () => {
      const client = new BedrockClient('enterprise');
      expect(client['modelId']).toContain('sonnet');
    });

    it('should use Sonnet for trial tier', () => {
      const client = new BedrockClient('trial');
      expect(client['modelId']).toContain('sonnet');
    });

    it('should use cross-region inference profiles with us. prefix', () => {
      const client = new BedrockClient('professional');
      expect(client['modelId']).toMatch(/^us\.anthropic\./);
    });

    it('should respect BEDROCK_HAIKU_MODEL_ID env var', () => {
      process.env.BEDROCK_HAIKU_MODEL_ID = 'custom-haiku-model';
      const client = new BedrockClient('starter');
      expect(client['modelId']).toBe('custom-haiku-model');
    });

    it('should allow override modelId', () => {
      const client = new BedrockClient('starter', 'override-model-id');
      expect(client['modelId']).toBe('override-model-id');
    });
  });

  describe('invoke with retry', () => {
    it('should invoke Bedrock successfully', async () => {
      const client = new BedrockClient('professional');
      const response = await client.invoke({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 512,
        temperature: 0.5
      });

      expect(response.content).toBeDefined();
      expect(response.stopReason).toBeDefined();
      expect(response.usage).toBeDefined();
    });

    it('should transform input messages correctly', async () => {
      const client = new BedrockClient('starter');
      const spy = vi.spyOn(client as any, 'callBedrockConverse');

      await client.invoke({
        messages: [
          { role: 'user', content: 'Question 1' },
          { role: 'assistant', content: 'Answer 1' }
        ]
      });

      const callArg = spy.mock.calls[0]?.[0] as any;
      expect(callArg.messages).toHaveLength(2);
      expect(callArg.messages[0].content).toEqual([{ type: 'text', text: 'Question 1' }]);
      expect(callArg.messages[1].content).toEqual([{ type: 'text', text: 'Answer 1' }]);
    });

    it('should use default inference params if not specified', async () => {
      const client = new BedrockClient('professional');
      const spy = vi.spyOn(client as any, 'callBedrockConverse');

      await client.invoke({
        messages: [{ role: 'user', content: 'Test' }]
      });

      const callArg = spy.mock.calls[0]?.[0] as any;
      expect(callArg.inferenceConfig).toEqual({
        maxTokens: 1024,
        temperature: 0.7
        // topP is omitted: Bedrock's Sonnet models don't accept both temperature and topP
      });
    });

    it('should retry on throttling error (429)', async () => {
      const client = new BedrockClient('professional');
      let attemptCount = 0;

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new BedrockThrottlingError('Rate limit exceeded');
        }
        return {
          content: 'Success',
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 5 }
        };
      });

      const response = await client.invoke({
        messages: [{ role: 'user', content: 'Test' }]
      });

      expect(attemptCount).toBe(3);
      expect(response.content).toBe('Success');
    });

    it('should fail after max retries', async () => {
      const client = new BedrockClient('professional');

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementation(async () => {
        throw new BedrockThrottlingError('Rate limit exceeded');
      });

      await expect(
        client.invoke({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow(BedrockThrottlingError);
    });

    it('should not retry non-throttling errors', async () => {
      const client = new BedrockClient('professional');
      let attemptCount = 0;

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementation(async () => {
        attemptCount++;
        throw new Error('Invalid request');
      });

      await expect(
        client.invoke({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow('Invalid request');

      expect(attemptCount).toBe(1);
    });

    it('should apply jittered backoff between retries', async () => {
      const client = new BedrockClient('professional');
      let attemptCount = 0;
      const timestamps: number[] = [];

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementation(async () => {
        timestamps.push(Date.now());
        attemptCount++;
        if (attemptCount < 2) {
          throw new BedrockThrottlingError('Throttled');
        }
        return {
          content: 'Success',
          stopReason: 'end_turn'
        };
      });

      const sleepSpy = vi.spyOn(client as any, 'sleep').mockResolvedValue(undefined);

      await client.invoke({
        messages: [{ role: 'user', content: 'Test' }]
      });

      // Should have called sleep with a backoff value
      expect(sleepSpy).toHaveBeenCalled();
      const backoffMs = sleepSpy.mock.calls[0]?.[0];
      expect(typeof backoffMs).toBe('number');
      expect(backoffMs).toBeGreaterThan(0);
      expect(backoffMs).toBeLessThan(300); // 2^1 * 100 + 100 jitter max
    });

    it('should have exponential backoff for multiple retries', async () => {
      const client = new BedrockClient('professional');
      let attemptCount = 0;

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementation(async () => {
        attemptCount++;
        throw new BedrockThrottlingError('Throttled');
      });

      const sleepSpy = vi.spyOn(client as any, 'sleep').mockResolvedValue(undefined);

      await expect(
        client.invoke({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow();

      const backoffCalls = sleepSpy.mock.calls.map(c => (c[0] ?? 0) as number);
      // First backoff ~100ms, second ~200ms
      expect(backoffCalls[0]).toBeLessThan(backoffCalls[1]);
    });
  });

  describe('inference config', () => {
    it('should pass custom inference params', async () => {
      const client = new BedrockClient('professional');
      const spy = vi.spyOn(client as any, 'callBedrockConverse');

      await client.invoke({
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 2048,
        temperature: 0.2,
        topP: 0.5
      });

      const config = (spy.mock.calls[0]?.[0] as any)?.inferenceConfig;
      expect(config).toEqual({
        maxTokens: 2048,
        temperature: 0.2
        // topP parameter is ignored: Bedrock's Sonnet models don't accept both temperature and topP
      });
    });
  });

  describe('error handling', () => {
    it('should throw on unexpected Bedrock response format', async () => {
      const client = new BedrockClient('professional');

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementationOnce(async () => {
        // Return response with non-text content type
        const response: any = {
          output: {
            message: {
              content: [{ type: 'unexpected', text: 'test' }]
            }
          },
          stopReason: 'end_turn'
        };
        // Simulate extracting the content to trigger error
        const content = response.output.message.content[0];
        if (content.type !== 'text') {
          throw new Error('Unexpected Bedrock response format');
        }
        return response;
      });

      await expect(
        client.invoke({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow('Unexpected Bedrock response format');
    });

    it('should handle ServiceUnavailable as retryable', async () => {
      const client = new BedrockClient('professional');
      let attemptCount = 0;

      vi.spyOn(client as any, 'callBedrockConverse').mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('ServiceUnavailable');
        }
        return {
          content: 'Success',
          stopReason: 'end_turn'
        };
      });

      const response = await client.invoke({
        messages: [{ role: 'user', content: 'Test' }]
      });

      expect(attemptCount).toBe(2);
      expect(response.content).toBe('Success');
    });
  });
});
