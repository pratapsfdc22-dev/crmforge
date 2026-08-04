/**
 * Task Orchestrator
 *
 * State machine: queued -> planning -> (awaiting_approval) -> executing -> verifying -> succeeded|failed
 * - Planning: system prompt + tool catalog, model returns JSON plan
 * - Risk assessment: read_only | sandbox_write | prod_write
 * - Approval gate for prod_write
 * - Sequential execution with step recording
 * - Verification against original intent
 * - Constraints: 20 steps max, 10 minute timeout
 */

import { z } from 'zod';
import type { TenantContext } from './tenant-context.js';
import type { BedrockClient } from './bedrock-client.js';
import { TOOL_REGISTRY, type ToolName } from './tools.js';

/**
 * Plan step schema
 */
export const PlanStepSchema = z.object({
  tool: z.enum(['queryJira', 'querySalesforce', 'triggerN8nWorkflow']),
  input: z.record(z.unknown()),
  rationale: z.string().min(1)
});

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema).max(20),
  risk: z.enum(['read_only', 'sandbox_write', 'prod_write']),
  summary: z.string().min(1)
});

export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Task state
 */
export type TaskState = 'queued' | 'planning' | 'awaiting_approval' | 'executing' | 'verifying' | 'succeeded' | 'failed';

/**
 * Task step record
 */
export interface TaskStepRecord {
  step_index: number;
  tool_name: string;
  input_redacted: string;
  output_summary: string;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
  started_at: Date;
  completed_at?: Date;
}

/**
 * Task execution record
 */
export interface TaskExecution {
  id: string;
  org_id: string;
  user_id: string;
  state: TaskState;
  intent: string;
  plan?: Plan;
  steps: TaskStepRecord[];
  requires_approval: boolean;
  approved_at?: Date;
  approved_by?: string;
  completed_at?: Date;
  error?: string;
  created_at: Date;
}

/**
 * Orchestrator
 */
export class Orchestrator {
  private timeout = 10 * 60 * 1000; // 10 minutes
  private maxSteps = 20;

  constructor(
    private ctx: TenantContext,
    private bedrockClient: BedrockClient
  ) {}

  /**
   * Plan a task by calling the model with tool catalog
   */
  async plan(intent: string): Promise<{ plan: Plan; repaired: boolean }> {
    const toolCatalog = [
      {
        name: 'queryJira',
        description: 'Query Jira for issues',
        params: { jql: 'string', maxResults: 'number' }
      },
      {
        name: 'querySalesforce',
        description: 'Query Salesforce for records',
        params: { soql: 'string', limit: 'number' }
      },
      {
        name: 'triggerN8nWorkflow',
        description: 'Trigger an n8n workflow',
        params: { workflowId: 'string', input: 'object' }
      }
    ];

    const systemPrompt = `You are a task orchestration planner. Given a user intent, plan a sequence of steps using available tools.
Return a JSON object with:
- steps: array of {tool, input, rationale}
- risk: 'read_only' | 'sandbox_write' | 'prod_write'
- summary: brief description

Available tools:
${JSON.stringify(toolCatalog, null, 2)}

Never include credentials in inputs. Inputs are validated and credentials injected from context.`;

    try {
      // Call Bedrock to plan
      const response = await this.bedrockClient.invoke({
        systemPrompt,
        userMessage: `Intent: ${intent}`,
        temperature: 0.7,
        maxTokens: 2000
      });

      // Parse and validate response
      const parsed = JSON.parse(response);
      const plan = PlanSchema.parse(parsed);

      return { plan, repaired: false };
    } catch (error) {
      // Attempt one repair: ask for JSON-only response
      if (error instanceof Error && error.message.includes('JSON')) {
        try {
          const response = await this.bedrockClient.invoke({
            systemPrompt,
            userMessage: `Intent: ${intent}

Please respond ONLY with a valid JSON object, no markdown or other text.`,
            temperature: 0.7,
            maxTokens: 2000
          });

          const parsed = JSON.parse(response);
          const plan = PlanSchema.parse(parsed);

          return { plan, repaired: true };
        } catch {
          throw new Error('Failed to generate valid plan after repair');
        }
      }

      throw error;
    }
  }

  /**
   * Redact sensitive data from input
   */
  private redactInput(input: any): string {
    const sensitive = ['password', 'secret', 'token', 'key', 'credential', 'api_key', 'apiKey'];
    const copy = JSON.parse(JSON.stringify(input));

    const redactObject = (obj: any) => {
      for (const key in obj) {
        const lowerKey = key.toLowerCase();
        if (sensitive.some(s => lowerKey.includes(s))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redactObject(obj[key]);
        }
      }
    };

    redactObject(copy);
    return JSON.stringify(copy).slice(0, 100);
  }

  /**
   * Execute a plan step sequentially
   */
  async executeStep(step: PlanStep, stepIndex: number): Promise<TaskStepRecord> {
    const startedAt = new Date();

    const record: TaskStepRecord = {
      step_index: stepIndex,
      tool_name: step.tool,
      input_redacted: this.redactInput(step.input),
      output_summary: '',
      status: 'pending',
      started_at: startedAt
    };

    try {
      // Validate tool exists
      if (!(step.tool in TOOL_REGISTRY)) {
        throw new Error(`Unknown tool: ${step.tool}`);
      }

      // Execute tool
      const toolFn = TOOL_REGISTRY[step.tool as ToolName];
      const result = await toolFn(this.ctx, step.input);

      if (!result.success) {
        record.status = 'failed';
        record.error = result.error;
        record.output_summary = `Error: ${result.error}`;
      } else {
        record.status = 'completed';
        record.output_summary = JSON.stringify(result.data).slice(0, 200);
      }
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : 'Unknown error';
      record.output_summary = `Exception: ${record.error}`;
    }

    record.completed_at = new Date();
    return record;
  }

  /**
   * Verify task completion
   */
  async verify(intent: string, steps: TaskStepRecord[]): Promise<{ verified: boolean; summary: string }> {
    const systemPrompt = `You are a verification agent. Given an original intent and completed steps, verify if the task was completed successfully.
Return JSON: {verified: boolean, summary: string}`;

    try {
      const stepsText = steps.map(s => `${s.tool_name}: ${s.output_summary}`).join('\n');

      const response = await this.bedrockClient.invoke({
        systemPrompt,
        userMessage: `Intent: ${intent}

Completed steps:
${stepsText}

Was this intent fulfilled? Return only JSON.`,
        temperature: 0.5,
        maxTokens: 500
      });

      const parsed = JSON.parse(response);
      return {
        verified: Boolean(parsed.verified),
        summary: parsed.summary || 'Verification complete'
      };
    } catch (error) {
      return {
        verified: false,
        summary: 'Verification failed'
      };
    }
  }

  /**
   * Get timeout
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * Get max steps
   */
  getMaxSteps(): number {
    return this.maxSteps;
  }
}
