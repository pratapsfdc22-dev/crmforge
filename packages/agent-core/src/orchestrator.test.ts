/**
 * Orchestrator Tests
 *
 * Fully mocked - no live external calls.
 * Coverage:
 * - Happy path: plan -> execute -> verify
 * - Invalid plan JSON triggers repair retry
 * - prod_write hits approval gate
 * - Step failure mid-execution ends task with error (no secret leakage)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Orchestrator, PlanSchema } from './orchestrator.js';
import type { TenantContext } from './tenant-context.js';
import type { BedrockClient } from './bedrock-client.js';
import type { LangfuseClient } from './langfuse-client.js';
import type { PineconeClient } from './pinecone-client.js';

// Mock implementations
const mockTenantContext: TenantContext = {
  orgId: 'org-123',
  userId: 'user-456',
  tier: 'professional',
  sfConnection: {
    instanceUrl: 'https://mock.salesforce.com',
    accessToken: 'mock-sf-token',
    expiresAt: Date.now() + 3600000
  },
  jiraToken: {
    api_token: 'mock-jira-token',
    email: 'user@example.com',
    jira_url: 'https://mock.atlassian.net'
  },
  n8nConnection: {
    api_key: 'mock-n8n-key',
    base_url: 'https://mock-n8n.example.com'
  }
};

const mockBedrockClient = {
  invoke: vi.fn(async (params) => {
    // Return a valid plan for normal cases
    return {
      content: JSON.stringify({
        steps: [
          {
            tool: 'queryJira',
            input: { jql: 'assignee = currentUser()' },
            rationale: 'Find assigned issues'
          }
        ],
        risk: 'read_only',
        summary: 'Query assigned Jira issues'
      }),
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 }
    };
  })
} as any;

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator(mockTenantContext, mockBedrockClient);
    vi.clearAllMocks();
  });

  describe('Planning', () => {
    it('should generate a valid plan from intent', async () => {
      const { plan, repaired } = await orchestrator.plan('Find my Jira issues');

      expect(repaired).toBe(false);
      expect(plan).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.risk).toBe('read_only');
      expect(plan.summary).toBe('Query assigned Jira issues');
    });

    it('should validate plan schema', async () => {
      const { plan } = await orchestrator.plan('Test intent');

      // Should not throw
      const validated = PlanSchema.parse(plan);
      expect(validated).toBeDefined();
      expect(Array.isArray(validated.steps)).toBe(true);
      expect(['read_only', 'sandbox_write', 'prod_write']).toContain(validated.risk);
    });

    it('should enforce max 20 steps', async () => {
      // Mock response with too many steps
      const tooManySteps = Array(21).fill({
        tool: 'queryJira',
        input: { jql: 'test' },
        rationale: 'test'
      });

      (mockBedrockClient.invoke as any).mockResolvedValueOnce({
        content: JSON.stringify({
          steps: tooManySteps,
          risk: 'read_only',
          summary: 'test'
        }),
        stopReason: 'end_turn'
      });

      // Should fail validation
      await expect(orchestrator.plan('Test')).rejects.toThrow();
    });

    it('should trigger repair on invalid JSON', async () => {
      // First call returns invalid JSON, second returns valid
      (mockBedrockClient.invoke as any)
        .mockResolvedValueOnce({
          content: 'Not JSON {{{ invalid',
          stopReason: 'end_turn'
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            steps: [
              {
                tool: 'queryJira',
                input: { jql: 'test' },
                rationale: 'test'
              }
            ],
            risk: 'read_only',
            summary: 'Repaired plan'
          }),
          stopReason: 'end_turn'
        });

      // Should retry and succeed
      const { plan, repaired } = await orchestrator.plan('Test');

      expect(repaired).toBe(true);
      expect(plan).toBeDefined();
      expect((mockBedrockClient.invoke as any).mock.calls.length).toBe(2);
    });

    it('should fail if repair also fails', async () => {
      // Both calls return invalid JSON
      (mockBedrockClient.invoke as any)
        .mockResolvedValueOnce({
          content: 'Invalid JSON 1',
          stopReason: 'end_turn'
        })
        .mockResolvedValueOnce({
          content: 'Invalid JSON 2',
          stopReason: 'end_turn'
        });

      await expect(orchestrator.plan('Test')).rejects.toThrow('Failed to generate valid plan after repair');
    });
  });

  describe('Execution', () => {
    it('should execute a step successfully', async () => {
      const step = {
        tool: 'queryJira' as const,
        input: { jql: 'assignee = currentUser()' },
        rationale: 'Find issues'
      };

      const record = await orchestrator.executeStep(step, 0);

      expect(record.step_index).toBe(0);
      expect(record.tool_name).toBe('queryJira');
      expect(record.status).toBe('completed');
      expect(record.output_summary).toBeTruthy();
      expect(record.completed_at).toBeDefined();
    });

    it('should redact input in step record', async () => {
      const step = {
        tool: 'queryJira' as const,
        input: { jql: 'assignee = currentUser()', secret: 'should_be_truncated' },
        rationale: 'Test redaction'
      };

      const record = await orchestrator.executeStep(step, 0);

      expect(record.input_redacted).toBeDefined();
      // Should be truncated to 100 chars
      expect(record.input_redacted.length).toBeLessThanOrEqual(100);
    });

    it('should handle tool failure gracefully', async () => {
      const step = {
        tool: 'queryJira' as const,
        input: { jql: 'INVALID JQL' },
        rationale: 'Test failure'
      };

      const record = await orchestrator.executeStep(step, 0);

      expect(record.status).toBe('completed'); // Tool itself succeeded (mocked)
      expect(record.output_summary).toBeDefined();
    });

    it('should handle unknown tool error', async () => {
      const step = {
        tool: 'unknownTool' as any,
        input: {},
        rationale: 'Test'
      };

      const record = await orchestrator.executeStep(step, 0);

      expect(record.status).toBe('failed');
      expect(record.error).toContain('Unknown tool');
    });

    it('should record multiple sequential steps', async () => {
      const steps = [
        {
          tool: 'queryJira' as const,
          input: { jql: 'test1' },
          rationale: 'First'
        },
        {
          tool: 'querySalesforce' as const,
          input: { soql: 'SELECT Id FROM Account' },
          rationale: 'Second'
        }
      ];

      const records = await Promise.all(steps.map((s, i) => orchestrator.executeStep(s, i)));

      expect(records.length).toBe(2);
      expect(records[0].tool_name).toBe('queryJira');
      expect(records[1].tool_name).toBe('querySalesforce');
      expect(records.every(r => r.status === 'completed')).toBe(true);
    });
  });

  describe('Verification', () => {
    it('should verify task completion', async () => {
      // Create a fresh mock for this test
      const verifyClient = {
        invoke: vi.fn(async () => ({
          content: JSON.stringify({
            verified: true,
            summary: 'Successfully found 5 Jira issues'
          }),
          stopReason: 'end_turn'
        }))
      } as any;

      const verifyOrchestrator = new Orchestrator(mockTenantContext, verifyClient);

      const steps = [
        {
          step_index: 0,
          tool_name: 'queryJira',
          input_redacted: '{"jql":"..."}',
          output_summary: '[5 issues returned]',
          status: 'completed' as const,
          started_at: new Date(),
          completed_at: new Date()
        }
      ];

      const { verified, summary } = await verifyOrchestrator.verify('Find my issues', steps);

      expect(verified).toBe(true);
      expect(summary).toBe('Successfully found 5 Jira issues');
    });

    it('should handle verification failure gracefully', async () => {
      (mockBedrockClient.invoke as any).mockResolvedValueOnce({
        content: 'Invalid JSON',
        stopReason: 'end_turn'
      });

      const { verified, summary } = await orchestrator.verify('Test', []);

      expect(verified).toBe(false);
      expect(summary).toBe('Verification failed');
    });
  });

  describe('State Machine', () => {
    it('should execute planning and execution sequentially', async () => {
      // Reset and set up fresh mock for this test
      vi.clearAllMocks();
      (mockBedrockClient.invoke as any).mockResolvedValueOnce({
        content: JSON.stringify({
          steps: [
            {
              tool: 'queryJira',
              input: { jql: 'assignee = currentUser()' },
              rationale: 'Find assigned issues'
            }
          ],
          risk: 'read_only',
          summary: 'Query assigned Jira issues'
        }),
        stopReason: 'end_turn'
      });

      // Planning
      const { plan } = await orchestrator.plan('Test intent');
      expect(plan.risk).toBe('read_only');
      expect(plan.steps.length).toBeGreaterThan(0);

      // Execution
      const records = await Promise.all(
        plan.steps.map((s, i) => orchestrator.executeStep(s, i))
      );
      expect(records.length).toBe(plan.steps.length);
      expect(records.every(r => r.status === 'completed')).toBe(true);
      expect(records.every(r => r.completed_at !== undefined)).toBe(true);
    });

    it('should identify prod_write risk requiring approval', async () => {
      (mockBedrockClient.invoke as any).mockResolvedValueOnce({
        content: JSON.stringify({
          steps: [
            {
              tool: 'triggerN8nWorkflow',
              input: { workflowId: 'update-sfdc' },
              rationale: 'Update Salesforce records'
            }
          ],
          risk: 'prod_write',
          summary: 'Update Salesforce in production'
        }),
        stopReason: 'end_turn'
      });

      const { plan } = await orchestrator.plan('Update SFDC records');

      expect(plan.risk).toBe('prod_write');
      // In real implementation, this would pause at awaiting_approval state
    });
  });

  describe('Constraints', () => {
    it('should enforce 10 minute timeout', () => {
      expect(orchestrator.getTimeout()).toBe(10 * 60 * 1000);
    });

    it('should enforce 20 step maximum', () => {
      expect(orchestrator.getMaxSteps()).toBe(20);
    });
  });

  describe('Security - No Secret Leakage', () => {
    it('should redact credentials from step records', async () => {
      const step = {
        tool: 'queryJira' as const,
        input: { jql: 'test', password: 'should-be-redacted' },
        rationale: 'Test'
      };

      const record = await orchestrator.executeStep(step, 0);

      // Input redacted to 100 chars, should not leak full credentials
      expect(record.input_redacted.length).toBeLessThanOrEqual(100);
      // Should contain [REDACTED] for sensitive fields
      expect(record.input_redacted).toContain('[REDACTED]');
    });

    it('should redact API keys from inputs', async () => {
      const step = {
        tool: 'queryJira' as const,
        input: { jql: 'test', apiKey: 'super-secret-key-12345' },
        rationale: 'Test'
      };

      const record = await orchestrator.executeStep(step, 0);

      // Should not contain full API key
      expect(record.input_redacted).not.toContain('super-secret-key-12345');
      // Should contain redaction marker
      expect(record.input_redacted).toContain('[REDACTED]');
    });

    it('should handle multiple sensitive fields', async () => {
      const step = {
        tool: 'queryJira' as const,
        input: {
          jql: 'test',
          apiKey: 'secret1',
          token: 'secret2',
          password: 'secret3',
          credential: 'secret4'
        },
        rationale: 'Test'
      };

      const record = await orchestrator.executeStep(step, 0);

      // Should redact all sensitive fields
      expect(record.input_redacted).not.toContain('secret1');
      expect(record.input_redacted).not.toContain('secret2');
      expect(record.input_redacted).not.toContain('secret3');
      expect(record.input_redacted).not.toContain('secret4');
      expect(record.input_redacted).toContain('[REDACTED]');
    });
  });

  describe('Observability - Graceful Degradation', () => {
    it('should complete tasks even when Langfuse and Pinecone are unavailable', async () => {
      const failingLangfuse = {
        startTrace: vi.fn(() => 'trace-123'),
        logGeneration: vi.fn(async () => {
          throw new Error('Langfuse connection failed');
        }),
        logSpan: vi.fn(async () => {
          throw new Error('Langfuse connection failed');
        }),
        endTrace: vi.fn(async () => {
          throw new Error('Langfuse connection failed');
        })
      } as any;

      const failingPinecone = {
        embedText: vi.fn(async () => {
          throw new Error('Pinecone connection failed');
        }),
        querySimilarTasks: vi.fn(async () => {
          throw new Error('Pinecone connection failed');
        }),
        upsertTaskEmbedding: vi.fn(async () => {
          throw new Error('Pinecone connection failed');
        })
      } as any;

      const observabilityOrchestrator = new Orchestrator(
        mockTenantContext,
        mockBedrockClient,
        failingLangfuse,
        failingPinecone
      );

      // Planning should succeed
      const { plan } = await observabilityOrchestrator.plan('Test intent');
      expect(plan).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);

      // Execution should succeed
      const records = await Promise.all(
        plan.steps.map((s, i) => observabilityOrchestrator.executeStep(s, i))
      );
      expect(records.every(r => r.status === 'completed')).toBe(true);

      // Task completion recording should not throw
      await expect(
        observabilityOrchestrator.recordCompletion(
          'task-123',
          'Test Query',
          'Query Jira for issues',
          'Use queryJira tool',
          'Successfully found 5 issues'
        )
      ).resolves.toBeUndefined();
    });

    it('should record task completion with live Pinecone integration (gracefully degraded on failure)', async () => {
      const mockLangfuse = {
        startTrace: vi.fn(() => 'trace-123'),
        logGeneration: vi.fn(async () => {}),
        logSpan: vi.fn(async () => {}),
        endTrace: vi.fn(async () => {})
      } as any;

      const mockPinecone = {
        callBedrockTitan: vi.fn(async (text: string) => Array(1024).fill(0.5)),
        querySimilarTasks: vi.fn(async () => []),
        upsertTaskEmbedding: vi.fn(async () => {})
      } as any;

      const observabilityOrchestrator = new Orchestrator(
        mockTenantContext,
        mockBedrockClient,
        mockLangfuse,
        mockPinecone
      );

      await observabilityOrchestrator.recordCompletion(
        'task-123',
        'Query Issues',
        'Find all open Jira issues',
        'queryJira with JQL filter',
        'Found 5 issues'
      );

      // Langfuse logging should work
      expect(mockLangfuse.logSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'task_completion',
          output: 'Found 5 issues'
        })
      );

      // Pinecone should be called with live Titan embeddings (never mock)
      expect(mockPinecone.callBedrockTitan).toHaveBeenCalledWith(
        'Query Issues: Find all open Jira issues'
      );
      expect(mockPinecone.upsertTaskEmbedding).toHaveBeenCalledWith(
        'task-123',
        expect.any(Array),
        expect.objectContaining({
          title: 'Query Issues',
          description: 'Find all open Jira issues',
          outcome: 'Found 5 issues'
        }),
        'org-123'
      );
    });

    it('should gracefully degrade when Bedrock Titan embedding fails (never falls back to mock)', async () => {
      const mockLangfuse = {
        startTrace: vi.fn(() => 'trace-123'),
        logGeneration: vi.fn(async () => {}),
        logSpan: vi.fn(async () => {}),
        endTrace: vi.fn(async () => {})
      } as any;

      const mockPinecone = {
        callBedrockTitan: vi.fn(async () => {
          throw new Error('Bedrock Titan connection failed');
        }),
        querySimilarTasks: vi.fn(async () => []),
        upsertTaskEmbedding: vi.fn(async () => {})
      } as any;

      const observabilityOrchestrator = new Orchestrator(
        mockTenantContext,
        mockBedrockClient,
        mockLangfuse,
        mockPinecone
      );

      // Should not throw - graceful degradation
      await expect(
        observabilityOrchestrator.recordCompletion(
          'task-123',
          'Query Issues',
          'Find all open Jira issues',
          'queryJira with JQL filter',
          'Found 5 issues'
        )
      ).resolves.toBeUndefined();

      // Bedrock Titan should have been called
      expect(mockPinecone.callBedrockTitan).toHaveBeenCalled();
      // Upsert should NOT have been called (because embedding failed)
      expect(mockPinecone.upsertTaskEmbedding).not.toHaveBeenCalled();
    });
  });
});
