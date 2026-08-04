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
   */
  async embedText(text: string): Promise<number[]> {
    try {
      // In production: call Bedrock Titan embeddings API
      // Using BedrockRuntimeClient().invoke({
      //   modelId: 'amazon.titan-embed-text-v2:0',
      //   body: JSON.stringify({ inputText: text })
      // })

      // For testing: return mock embedding (1536-dim like Titan)
      const hash = this.hashText(text);
      return Array(1536).fill(0).map((_, i) => Math.sin(hash + i) * 0.5 + 0.5);
    } catch (error) {
      console.error('[Pinecone] Embedding failed (non-blocking):', error);
      throw error;
    }
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
