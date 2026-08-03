/**
 * Example integration: TenantContext + BedrockClient
 * Demonstrates how orchestrator layer would use the runtime core
 */

import { createClient } from '@supabase/supabase-js';
import { loadTenantContext, BedrockClient, type TenantContext } from './index';

/**
 * Example orchestrator that executes a task using the agent runtime core
 */
async function executeAgentTask(
  orgId: string,
  userId: string,
  taskInput: string
): Promise<string> {
  // 1. Load tenant context (credentials, tier, SF connection)
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const context: TenantContext = await loadTenantContext(
    supabase,
    orgId,
    userId,
    'professional',
    process.env.MASTER_ENC_KEY!
  );

  // 2. Create Bedrock client with tier-based routing
  const bedrockClient = new BedrockClient(context.tier);

  // 3. Build prompt with Salesforce context
  const systemPrompt = `You are a CRM agent for ${context.orgId}.
Access to Salesforce instance: ${context.sfConnection.instanceUrl}
Use the provided tools to fetch and update data.`;

  // 4. Invoke Claude for task execution
  const response = await bedrockClient.invoke({
    messages: [
      { role: 'user', content: `System: ${systemPrompt}` },
      { role: 'user', content: taskInput }
    ],
    maxTokens: 2048,
    temperature: 0.5
  });

  // 5. Process response
  console.log('Agent response:', response.content);
  if (response.usage) {
    console.log('Tokens used:', response.usage.inputTokens + response.usage.outputTokens);
  }

  return response.content;
}

/**
 * Tier-aware configuration example
 */
function getTierConfig(context: TenantContext) {
  const configs = {
    trial: { maxTokens: 512, temperature: 0.7 },
    starter: { maxTokens: 1024, temperature: 0.6 },
    professional: { maxTokens: 2048, temperature: 0.5 },
    enterprise: { maxTokens: 4096, temperature: 0.4 }
  };
  return configs[context.tier];
}

// Note: This file is for documentation/example only. The orchestrator
// state machine will be implemented in the next phase.

export { executeAgentTask, getTierConfig };
