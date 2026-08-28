# AI Rival MVP

Initial monorepo foundation for the AI Rival MVP.

## Architecture

* **Frontend**: React + TypeScript (Vite)
* **Hosting**: Cloudflare Pages / Workers
* **Backend / Database / Auth**: Supabase (Auth, Postgres, Storage, Edge Functions)
* **Billing**: Lemon Squeezy
* **AI Provider**: Gemini behind an AI provider abstraction
* **Source of Truth**: GitHub repository
* **Logic Rules**: Deterministic backend logic is authoritative; LLM outputs are advisory only

## Workspace Structure

* `apps/web`: Vite + React + TypeScript web application
* `packages/domain`: Core domain types and business logic abstractions
* `supabase/`: Migrations and Edge Functions
* `docs/`: Architecture and design documentation

## Available Commands

From the workspace root:

* `npm install` - Install all workspace dependencies
* `npm run typecheck` - Run TypeScript typecheck across all workspaces
* `npm run lint` - Run ESLint across all workspaces
* `npm run test` - Run tests with Vitest across all workspaces
* `npm run build` - Build domain package and web application
