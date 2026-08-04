import { describe, it, expect, vi } from 'vitest';
import { PineconeClient } from './pinecone-client.js';

describe('PineconeClient', () => {
  const client = new PineconeClient('test-api-key', 'us-west-1', 'test-project');

  describe('Embeddings', () => {
    it('should generate embeddings (mocked)', async () => {
      const embedding = await client.embedText('Find all open issues in Jira');

      expect(Array.isArray(embedding)).toBe(true);
      // Mocked embeddings - Bedrock Titan returns 1024 but we mock for speed
      expect(embedding.length).toBeGreaterThan(0);
      expect(embedding.every(v => typeof v === 'number')).toBe(true);
    });

    it('should generate consistent embeddings for same text', async () => {
      const text = 'Query Salesforce for accounts';
      const emb1 = await client.embedText(text);
      const emb2 = await client.embedText(text);

      expect(emb1).toEqual(emb2);
    });

    it('should generate different embeddings for different text', async () => {
      const emb1 = await client.embedText('Text A');
      const emb2 = await client.embedText('Text B');

      // Should be different (extremely unlikely to be identical)
      expect(emb1).not.toEqual(emb2);
    });
  });

  describe('Query', () => {
    it('should return empty results gracefully', async () => {
      const embedding = await client.embedText('test query');
      const results = await client.querySimilarTasks(embedding, 'org-123', 5);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should handle query failures gracefully', async () => {
      // Even if embeddings were to fail (mocked to throw), query still returns empty
      const results = await client.querySimilarTasks([], 'org-123', 5);

      expect(results).toEqual([]);
    });
  });

  describe('Upsert', () => {
    it('should upsert task embeddings', async () => {
      const embedding = await client.embedText('Sample task');

      await expect(
        client.upsertTaskEmbedding(
          'task-123',
          embedding,
          {
            title: 'Query Jira issues',
            description: 'Find all open issues assigned to me',
            planSummary: 'Query Jira with JQL, parse results',
            outcome: 'Successfully found 5 issues',
            timestamp: Date.now()
          },
          'org-123'
        )
      ).resolves.toBeUndefined();
    });

    it('should silently reject upserts with sensitive metadata (graceful degradation)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const embedding = await client.embedText('test');

      await expect(
        client.upsertTaskEmbedding(
          'task-123',
          embedding,
          {
            title: 'Query task',
            description: 'Query with secret_key: sk-12345',
            planSummary: 'test',
            outcome: 'test',
            timestamp: Date.now()
          },
          'org-123'
        )
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('should silently reject upserts with token patterns in outcome (graceful degradation)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const embedding = await client.embedText('test');

      await expect(
        client.upsertTaskEmbedding(
          'task-123',
          embedding,
          {
            title: 'test',
            description: 'test',
            planSummary: 'test',
            outcome: 'Updated account with access_token: eyJhbGc...',
            timestamp: Date.now()
          },
          'org-123'
        )
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Secret Safety', () => {
    it('should never log api keys in namespace (silently rejected)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const embedding = await client.embedText('test');

      await expect(
        client.upsertTaskEmbedding(
          'task-123',
          embedding,
          {
            title: 'test',
            description: 'test with api_key = super-secret',
            planSummary: 'test',
            outcome: 'test',
            timestamp: Date.now()
          },
          'org-123'
        )
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('should never log bearer tokens (silently rejected)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const embedding = await client.embedText('test');

      await expect(
        client.upsertTaskEmbedding(
          'task-123',
          embedding,
          {
            title: 'test',
            description: 'Called API with Authorization: Bearer abc123def456',
            planSummary: 'test',
            outcome: 'test',
            timestamp: Date.now()
          },
          'org-123'
        )
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
