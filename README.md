# ForgeSF

Multi-tenant SaaS platform wrapping the Salesforce Developer AI Agent (salesforce-ai-agent-mcp).

## Architecture

- **apps/web**: Next.js 14 App Router frontend with Tailwind & shadcn/ui
  - Marketing pages: `/`, `/login`, `/signup`
  - Authenticated app: `/app` (Tasks, Connections, Team, Usage, Settings)
- **apps/api**: Fastify + TypeScript backend on Node 22
  - Zod-validated env loader for secrets (Supabase, AWS Bedrock, Langfuse, Pinecone, Stripe)
  - Pino logging with automatic secret redaction
  - Railway-ready deployment structure
- **packages/shared**: Shared Zod schemas and TypeScript types
- **packages/db**: Supabase migrations and generated TypeScript types
- **packages/agent-core**: AI agent orchestration layer (Phase 3)

## Development

```bash
pnpm install
pnpm dev  # Runs web:3000 and api:4000
```

## Environment Setup

Copy `.env.example` files in `apps/web` and `apps/api` and populate with your credentials.

---

Built with Turborepo + pnpm workspaces.
