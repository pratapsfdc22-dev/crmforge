/**
 * Wrapped Tool Layer
 *
 * Wraps salesforce-ai-agent-mcp tools so credentials are NEVER accepted as model input.
 * Credentials are injected from TenantContext only.
 * All inputs validated with Zod.
 */

import { z } from 'zod';
import type { TenantContext } from './tenant-context.js';

/**
 * Tool input schemas - credentials excluded (injected from context)
 */
export const JiraQuerySchema = z.object({
  jql: z.string().min(1).describe('Jira Query Language string'),
  maxResults: z.number().int().positive().optional().default(50)
});

export const SalesforceQuerySchema = z.object({
  soql: z.string().min(1).describe('Salesforce Object Query Language'),
  limit: z.number().int().positive().optional().default(100)
});

export const N8nTriggerSchema = z.object({
  workflowId: z.string().min(1).describe('n8n workflow ID'),
  input: z.record(z.unknown()).optional().describe('Workflow input data')
});

export type JiraQueryInput = z.infer<typeof JiraQuerySchema>;
export type SalesforceQueryInput = z.infer<typeof SalesforceQuerySchema>;
export type N8nTriggerInput = z.infer<typeof N8nTriggerSchema>;

/**
 * Tool result type
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  redactedInput: string;
}

/**
 * Wrapped Jira query tool
 */
export async function queryJira(
  ctx: TenantContext,
  input: JiraQueryInput
): Promise<ToolResult> {
  try {
    // Validate input
    const validated = JiraQuerySchema.parse(input);

    // Get Jira credentials from context
    if (!ctx.jiraToken) {
      return {
        success: false,
        error: 'No Jira credentials configured',
        redactedInput: `JiraQuery(jql="${validated.jql}")`
      };
    }

    // In real implementation, call Jira API here
    // For now, mock it
    return {
      success: true,
      data: {
        issues: [],
        total: 0,
        maxResults: validated.maxResults
      },
      redactedInput: `JiraQuery(jql="${validated.jql}", maxResults=${validated.maxResults})`
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      redactedInput: 'JiraQuery(INVALID)'
    };
  }
}

/**
 * Wrapped Salesforce query tool
 */
export async function querySalesforce(
  ctx: TenantContext,
  input: SalesforceQueryInput
): Promise<ToolResult> {
  try {
    // Validate input
    const validated = SalesforceQuerySchema.parse(input);

    // Salesforce connection is always present
    if (!ctx.sfConnection) {
      return {
        success: false,
        error: 'Salesforce not configured',
        redactedInput: `SalesforceQuery(soql="${validated.soql}")`
      };
    }

    // In real implementation, call Salesforce API here
    // For now, mock it
    return {
      success: true,
      data: {
        records: [],
        totalSize: 0
      },
      redactedInput: `SalesforceQuery(soql="${validated.soql}", limit=${validated.limit})`
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      redactedInput: 'SalesforceQuery(INVALID)'
    };
  }
}

/**
 * Wrapped n8n workflow trigger tool
 */
export async function triggerN8nWorkflow(
  ctx: TenantContext,
  input: N8nTriggerInput
): Promise<ToolResult> {
  try {
    // Validate input
    const validated = N8nTriggerSchema.parse(input);

    // Get n8n credentials from context
    if (!ctx.n8nConnection) {
      return {
        success: false,
        error: 'No n8n credentials configured',
        redactedInput: `N8nTrigger(workflowId="${validated.workflowId}")`
      };
    }

    // In real implementation, call n8n API here
    // For now, mock it
    return {
      success: true,
      data: {
        executionId: 'exec-' + Math.random().toString(36).substring(7),
        status: 'running'
      },
      redactedInput: `N8nTrigger(workflowId="${validated.workflowId}")`
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      redactedInput: 'N8nTrigger(INVALID)'
    };
  }
}

/**
 * Tool registry
 */
export const TOOL_REGISTRY = {
  queryJira,
  querySalesforce,
  triggerN8nWorkflow
} as const;

export type ToolName = keyof typeof TOOL_REGISTRY;
