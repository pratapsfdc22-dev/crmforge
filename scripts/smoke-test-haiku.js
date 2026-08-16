#!/usr/bin/env node
/**
 * Smoke test: Call Bedrock Haiku model via Converse API
 * Verifies the hardcoded model ID is valid and accessible
 *
 * Usage: node scripts/smoke-test-haiku.js
 * Requires: AWS credentials configured, .env with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
 */

require('dotenv').config();
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

async function testHaikuModel() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new BedrockRuntimeClient({ region });

  const modelId = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  const testPrompt = 'Reply with OK';

  console.log(`[Bedrock Haiku Smoke Test]`);
  console.log(`  Model: ${modelId}`);
  console.log(`  Region: ${region}`);
  console.log(`  Prompt: "${testPrompt}"`);
  console.log();

  try {
    const command = new ConverseCommand({
      modelId,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: testPrompt }]
        }
      ],
      inferenceConfig: {
        maxTokens: 100,
        temperature: 0.5
      }
    });

    console.log(`Calling Bedrock Converse API with Haiku model...`);
    const response = await client.send(command);

    // Parse response
    if (!response.output?.message?.content?.[0]) {
      throw new Error('Invalid response: missing message content');
    }

    const textContent = response.output.message.content[0]?.text;
    if (!textContent || typeof textContent !== 'string') {
      throw new Error('Unexpected response format: expected text content');
    }

    console.log();
    console.log(`✓ SUCCESS - Haiku model is valid and accessible!`);
    console.log(`  Model responded: "${textContent}"`);
    console.log(`  Stop reason: ${response.stopReason}`);
    if (response.usage) {
      console.log(`  Tokens: ${response.usage.inputTokens} input, ${response.usage.outputTokens} output`);
    }
    console.log();
    console.log(`Bedrock Haiku (us.anthropic.claude-haiku-4-5-20251001-v1:0) is working end-to-end.`);

    return true;
  } catch (error) {
    console.log();
    console.log(`✗ FAILED - Haiku model call failed:`);
    console.log();

    if (error instanceof Error) {
      console.log(`  Message: ${error.message}`);
      if (error.Code) {
        console.log(`  AWS Code: ${error.Code}`);
      }
      if (error.name) {
        console.log(`  Error Type: ${error.name}`);
      }
    }

    console.log();
    console.log(`Possible causes:`);
    console.log(`  - Model ID is invalid or not available in ${region}`);
    console.log(`  - AWS credentials missing or lack bedrock:InvokeModel permission`);
    console.log(`  - Cross-region inference profile not available in your account`);

    return false;
  }
}

testHaikuModel().then(success => {
  process.exit(success ? 0 : 1);
});
