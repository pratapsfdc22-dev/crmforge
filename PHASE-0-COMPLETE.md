# ForgeSF - Phase 0 Scaffold ✅

## Overview
Multi-tenant SaaS platform wrapping the Salesforce Developer AI Agent (`salesforce-ai-agent-mcp`).

## Completed Structure

### Monorepo Setup
- ✅ **pnpm workspaces** with Turborepo
- ✅ **Node 22** required
- ✅ **TypeScript strict mode** throughout
- ✅ **ESLint + Prettier** configured
- ✅ **Vitest** for testing
- ✅ **GitHub Actions CI** (lint, typecheck, test on PR)

### Apps

#### apps/web (Next.js 14 App Router)
- ✅ TypeScript strict mode
- ✅ Tailwind CSS + shadcn/ui components
- ✅ Routes implemented:
  - `/` - Marketing landing page
  - `/login` - Sign in page
  - `/signup` - Registration page
  - `/app` - Authenticated dashboard shell with sidebar
    - `/app` - Tasks view
    - `/app/connections` - Salesforce connections
    - `/app/team` - Team management
    - `/app/usage` - Usage metrics
    - `/app/settings` - Account settings
- ✅ Running on **http://localhost:3000**

#### apps/api (Fastify + Node 22)
- ✅ TypeScript ES modules
- ✅ Zod-validated environment loader with all required secrets:
  - Supabase (URL, service role key, JWT secret)
  - Database URL
  - Master encryption key
  - AWS credentials (Bedrock access)
  - Langfuse keys (LLM observability)
  - Pinecone API key (vector DB)
  - Stripe keys (payments)
- ✅ Pino logging with automatic redaction of sensitive fields matching `/secret|token|key|password/`
- ✅ Health check route at `/health`
- ✅ Railway-ready structure
- ✅ Running on **http://localhost:4000**

### Packages

#### packages/shared
- ✅ Shared Zod schemas and TypeScript types
- ✅ Built with `tsc`
- ✅ Example schemas: `UserSchema`, `TeamSchema`

#### packages/db
- ✅ Supabase migrations folder
- ✅ TypeScript type generation script (`pnpm generate`)
- ✅ Placeholder types file

#### packages/agent-core
- ✅ Placeholder package for Phase 3
- ✅ Exports version constant: `AGENT_CORE_VERSION`

## Development Commands

```bash
# Install dependencies
pnpm install

# Run both web (3000) and api (4000)
pnpm dev

# Build all packages
pnpm build

# Lint all packages
pnpm lint

# Type check all packages
pnpm typecheck

# Run tests
pnpm test

# Format code
pnpm format
```

## Environment Setup

### apps/api/.env
Copy from `.env.example` and populate with real credentials:
- Supabase project credentials
- AWS Bedrock keys
- Langfuse observability keys
- Pinecone vector DB key
- Stripe payment keys

### apps/web/.env
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## What's NOT Implemented Yet

Phase 0 is **scaffold-only**. The following will be added in later phases:

- ❌ Authentication (Supabase Auth)
- ❌ Database schema and migrations
- ❌ API business logic routes
- ❌ Salesforce OAuth connection flow
- ❌ AI agent orchestration (`salesforce-ai-agent-mcp` integration)
- ❌ Stripe billing integration
- ❌ Langfuse LLM observability
- ❌ Pinecone vector storage
- ❌ Multi-tenancy enforcement

## Verified ✅

- [x] `pnpm dev` runs both apps successfully
- [x] Web: http://localhost:3000 serves Next.js app
- [x] API: http://localhost:4000/health returns `{"status":"ok"}`
- [x] TypeScript compiles without errors
- [x] All routes render placeholder content
- [x] Environment validation works (API won't start without required vars)
- [x] Pino logging with secret redaction active

## Next Steps

**Phase 1**: Database schema, Supabase setup, authentication
**Phase 2**: Salesforce OAuth, API business logic, Stripe setup
**Phase 3**: AI agent core implementation with `salesforce-ai-agent-mcp`
