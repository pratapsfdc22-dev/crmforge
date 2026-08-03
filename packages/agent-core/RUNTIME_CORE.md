# ForgeSF Agent Runtime Core

Agent runtime foundation for ForgeSF, wrapping the Salesforce AI Agent MCP package with secure credential management and intelligent model routing.

## Architecture

### 1. **TenantContext Factory** (`tenant-context.ts`)

Multi-tenant credential container that loads and decrypts tenant secrets on-demand with JWT token caching.

**Key Features:**
- Loads Salesforce JWT, Jira OAuth, and n8n API credentials from encrypted vault
- Acquires Salesforce access tokens via JWT Bearer flow with in-memory cache (until expiry - 30s buffer)
- Returns immutable TenantContext with only safe fields (accessToken, never raw JWT)
- Per-tier credential isolation: orgId-level for SF/n8n, userId-level for Jira

**Exports:**
- `loadTenantContext(supabaseClient, orgId, userId, tier, masterKey)` → Promise<TenantContext>
- `TenantContext` interface with sfConnection, jiraToken, n8nConnection
- `Tier` type: 'trial' | 'starter' | 'professional' | 'enterprise'

### 2. **Bedrock Client Wrapper** (`bedrock-client.ts`)

Claude inference via AWS Bedrock with tier-based model routing and jittered backoff retry.

**Key Features:**
- Tier-based routing: starter → Haiku, else → Sonnet (via inference profiles)
- Environment variable overrides: `BEDROCK_HAIKU_MODEL_ID`, `BEDROCK_SONNET_MODEL_ID`
- Converse API with configurable inference params (maxTokens, temperature, topP)
- Automatic retry on throttling (429) or ServiceUnavailable with exponential backoff + jitter
- Max 3 retries, backoff = (2^attempt * 100ms) + random(0-100ms)

**Exports:**
- `BedrockClient` class with `invoke(params)` method
- `BedrockInvokeParams`, `BedrockInvokeResponse` types
- `BedrockThrottlingError` for specific retry detection

### 3. **Security Tests** (`tenant-context.test.ts`, `bedrock-client.test.ts`)

Comprehensive security validation ensuring secrets are never exposed.

**Critical Assertions:**
- Decrypted secrets never appear in error messages
- No console logging of raw credentials (client_secret, private_key, api_token)
- Returned TenantContext only exports safe fields (accessToken, not JWT)
- Secrets never passed to tracing/logging systems
- Token cache stores only Salesforce access tokens (safe to cache), not raw JWT

## Security Rules

### Secret Handling
1. **Never log** decrypted values anywhere (console, structured logs, traces)
2. **Never include** in error messages thrown to callers
3. **Never return** raw secrets outside TenantContext internal use
4. **Sanitize** error context before propagation

### Token Management
- SF access tokens cached in-memory with 30-second expiry buffer
- Cache key = `${orgId}:sf-token` to support multi-tenant isolation
- `clearTokenCache()` available for testing/cleanup

### Credential Scope
- **Org-level** (null userId): Salesforce JWT, n8n API key
- **User-level** (userId set): Jira OAuth token
- `loadTenantContext` validates all required secrets present before returning

## Usage Example

```typescript
import { loadTenantContext, BedrockClient } from '@forgesf/agent-core';
import { createClient } from '@supabase/supabase-js';

// Load tenant credentials
const supabase = createClient(url, key);
const context = await loadTenantContext(
  supabase,
  'org-123',
  'user-456',
  'professional',
  process.env.MASTER_ENC_KEY!
);

// Context has safe fields only
console.log(context.sfConnection.accessToken); // safe
console.log(context.tier); // 'professional'

// Invoke Claude via Bedrock
const client = new BedrockClient(context.tier);
const response = await client.invoke({
  messages: [{ role: 'user', content: 'What is CRM?' }],
  maxTokens: 512,
  temperature: 0.7
});
```

## Testing

```bash
pnpm test  # Run all tests (38 passing)
pnpm typecheck  # Verify TypeScript
pnpm build  # Compile to dist/
```

### Test Coverage
- **18 Bedrock tests**: tier routing, retry logic, backoff exponential scaling, error handling
- **6 TenantContext security tests**: secret isolation, no logging, scope validation
- **15 Vault tests** (existing): encryption/decryption, key derivation

## Dependencies

- `@supabase/supabase-js@^2.110.8` — Vault storage
- `@aws-sdk/client-bedrock-runtime@^3.600.0` — Bedrock API (for future integration)

## Next Steps

Following phases will add:
1. **Orchestrator State Machine** — Task execution, state transitions, error recovery
2. **Tool Layer** — Salesforce API wrapper, Jira integration, n8n workflows
3. **Langfuse & Pinecone** — Structured logging, observability, RAG integration

These will use TenantContext + BedrockClient as their foundation but remain scoped separately.
