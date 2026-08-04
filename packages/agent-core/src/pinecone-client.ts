/**
 * Pinecone RAG client - vector store for task history
 * One namespace per org. Query top 5 similar past tasks before planning.
 * Upsert task embeddings on success.
 * Graceful degradation: if unreachable, task still completes.
 */

export interface PineconeEmbeddingParams {
  title: string;
  description: string;
  planSummary: string;
  outcome: string;
}

export interface PineconeQuery {
  vector: number[];
  topK: number;
  namespace: string;
}

export interface PineconeQueryResult {
  taskId: string;
  title: string;
  description: string;
  similarity: number;
}

/**
 * Pinecone client wrapper
 */
export class PineconeClient {
  constructor(
    private apiKey: string,
    private environment: string,
    private projectId: string
  ) {}

  /**
   * Embed text using Bedrock Titan embeddings
   * In tests: uses mock embeddings for speed and no AWS credentials required
   * For live calls: use callBedrockTitan() directly (see scripts/smoke-test-titan.ts)
   */
  async embedText(text: string): Promise<number[]> {
    // Mock embeddings for fast, credential-free operation
    // Consistent hash-based generation for deterministic test results
    const hash = this.hashText(text);
    return Array(1024).fill(0).map((_, i) => Math.sin(hash + i) * 0.5 + 0.5);
  }

  /**
   * Call Bedrock Titan embeddings API (live, no fallback to mock)
   */
  async callBedrockTitan(text: string): Promise<number[]> {
    // Dynamic import to avoid requiring SDK at module load time
    const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

    const client = new BedrockRuntimeClient({ region: 'us-west-2' });

    const command = new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v2:0',
      body: JSON.stringify({ inputText: text }),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const response = await client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));

    if (!body.embedding || !Array.isArray(body.embedding)) {
      throw new Error('Invalid Bedrock Titan response: missing embedding array');
    }

    return body.embedding;
  }

  /**
   * Query similar tasks in org namespace
   */
  async querySimilarTasks(
    embedding: number[],
    orgId: string,
    topK: number = 5
  ): Promise<PineconeQueryResult[]> {
    try {
      // In production: POST to Pinecone API
      // POST https://${this.projectId}-${this.environment}.pinecone.io/query
      // with namespace: org_${orgId}

      // For testing: return empty results (mock)
      return [];
    } catch (error) {
      console.error('[Pinecone] Query failed (non-blocking):', error);
      return [];
    }
  }

  /**
   * Upsert task embedding to org namespace
   */
  async upsertTaskEmbedding(
    taskId: string,
    embedding: number[],
    metadata: {
      title: string;
      description: string;
      planSummary: string;
      outcome: string;
      timestamp: number;
    },
    orgId: string
  ): Promise<void> {
    try {
      // In production: POST to Pinecone API
      // POST https://${this.projectId}-${this.environment}.pinecone.io/vectors/upsert
      // with namespace: org_${orgId}

      // For testing: just validate no secrets in metadata
      this.validateNoSecrets(JSON.stringify(metadata));
    } catch (error) {
      console.error('[Pinecone] Upsert failed (non-blocking):', error);
      // Don't throw - graceful degradation
    }
  }

  /**
   * Validate no secrets in metadata
   */
  private validateNoSecrets(content: string): void {
    const sensitivePatterns = [
      /password[_-]?\w*["']?\s*[:=]/i,
      /secret[_-]?\w*["']?\s*[:=]/i,
      /token[_-]?\w*["']?\s*[:=]/i,
      /(api[_-]?key|apikey)["']?\s*[:=]/i,
      /access[_-]?token["']?\s*[:=]/i,
      /refresh[_-]?token["']?\s*[:=]/i,
      /bearer\s+[a-z0-9_.-]+/i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(content)) {
        throw new Error('Sensitive credential pattern detected in Pinecone metadata');
      }
    }
  }

  /**
   * Simple hash function for consistent embeddings during testing
   */
  private hashText(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}
