import { describe, it, expect, vi } from 'vitest';
import { LangfuseClient } from './langfuse-client.js';

describe('LangfuseClient', () => {
  const client = new LangfuseClient('test-api-key', 'test-public-key');

  describe('Secret Safety', () => {
    it('should silently reject (graceful degradation) generation logs with password patterns', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const traceId = client.startTrace({
        userId: 'user-123',
        sessionId: 'session-123',
        metadata: { orgId: 'org-123', tier: 'professional', taskId: 'task-123' }
      });

      expect(traceId).toBeTruthy();

      // Should not throw, but should log error silently
      await expect(
        client.logGeneration({
          name: 'test-generation',
          input: 'Query data with password: secret123',
          output: 'Results found'
        })
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('should silently reject generation logs with token patterns', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.startTrace({
        userId: 'user-123',
        sessionId: 'session-123',
        metadata: { orgId: 'org-123', tier: 'professional', taskId: 'task-123' }
      });

      await expect(
        client.logGeneration({
          name: 'test-generation',
          input: 'Safe input',
          output: 'access_token: eyJhbGciOiJIUzI1NiJ9'
        })
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('should silently reject span logs with api_key patterns', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.startTrace({
        userId: 'user-123',
        sessionId: 'session-123',
        metadata: { orgId: 'org-123', tier: 'professional', taskId: 'task-123' }
      });

      await expect(
        client.logSpan({
          name: 'tool-execution',
          input: 'Safe input',
          metadata: { apiKey: 'sk-1234567890' }
        })
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('should accept safe generation logs', async () => {
      client.startTrace({
        userId: 'user-123',
        sessionId: 'session-123',
        metadata: { orgId: 'org-123', tier: 'professional', taskId: 'task-123' }
      });

      await expect(
        client.logGeneration({
          name: 'safe-generation',
          input: 'Query Jira for issues',
          output: 'Found 5 issues',
          model: 'claude-3-5-sonnet',
          inputTokens: 100,
          outputTokens: 50,
          costUSD: 0.001
        })
      ).resolves.toBeUndefined();
    });

    it('should accept safe span logs', async () => {
      client.startTrace({
        userId: 'user-123',
        sessionId: 'session-123',
        metadata: { orgId: 'org-123', tier: 'professional', taskId: 'task-123' }
      });

      await expect(
        client.logSpan({
          name: 'queryJira',
          input: 'jql: assignee = currentUser()',
          output: '[{"key":"PROJ-123","summary":"Fix bug"}]',
          metadata: { toolName: 'queryJira', status: 'success' }
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('Trace Lifecycle', () => {
    it('should start and end traces', async () => {
      const traceId = client.startTrace({
        userId: 'user-123',
        sessionId: 'session-123',
        metadata: { orgId: 'org-123', tier: 'professional', taskId: 'task-123' }
      });

      expect(traceId).toMatch(/^trace-\d+-[a-z0-9]+$/);

      await client.endTrace();
      // After ending, logGeneration should not fail but also won't log
      await expect(
        client.logGeneration({
          name: 'test',
          input: 'test',
          output: 'test'
        })
      ).resolves.toBeUndefined();
    });
  });
});
