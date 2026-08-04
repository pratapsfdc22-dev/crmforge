#!/usr/bin/env node
/**
 * Smoke test: Call Bedrock Titan embeddings directly
 * Verifies IAM policy and model access work end-to-end
 *
 * Usage: node scripts/smoke-test-titan.js
 * Requires: AWS credentials configured, AWS_BEARER_TOKEN_BEDROCK or AWS key/secret
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

async function testTitanEmbeddings() {
  const client = new BedrockRuntimeClient({ region: 'us-west-2' });

  const modelId = 'amazon.titan-embed-text-v2:0';
  const testText = 'Find all open issues in Jira';

  console.log(`[Bedrock Titan Smoke Test]`);
  console.log(`  Model: ${modelId}`);
  console.log(`  Text: "${testText}"`);
  console.log();

  try {
    const command = new InvokeModelCommand({
      modelId,
      body: JSON.stringify({
        inputText: testText
      }),
      contentType: 'application/json',
      accept: 'application/json'
    });

    console.log(`Calling Bedrock Titan embeddings...`);
    const response = await client.send(command);

    // Parse response
    const body = JSON.parse(Buffer.from(response.body).toString('utf-8'));

    if (!body.embedding || !Array.isArray(body.embedding)) {
      throw new Error('Invalid response: missing embedding array');
    }

    console.log();
    console.log(`✓ SUCCESS - Titan embeddings working!`);
    console.log(`  Embedding dimension: ${body.embedding.length}`);
    console.log();
    console.log(`Bedrock Titan is accessible and working end-to-end.`);

    return true;
  } catch (error) {
    console.log();
    console.log(`✗ FAILED - Titan embeddings call failed:`);
    console.log();

    if (error instanceof Error) {
      console.log(`  Message: ${error.message}`);
      if (error.Code) {
        console.log(`  AWS Code: ${error.Code}`);
      }
    }

    console.log();
    console.log(`Check AWS credentials and IAM policy for bedrock:InvokeModel on Titan models.`);

    return false;
  }
}

testTitanEmbeddings().then(success => {
  process.exit(success ? 0 : 1);
});
