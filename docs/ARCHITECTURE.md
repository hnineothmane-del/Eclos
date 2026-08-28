# Architecture Document — V1

## Overview

This document defines the approved V1 architecture for the AI Rival MVP. The design emphasizes simplicity, determinism, and minimal infrastructure overhead.

## Approved Tech Stack

* **Frontend**: React + TypeScript (Vite)
* **Web Hosting**: Cloudflare Pages / Workers
* **Backend Platform**: Supabase (Auth, Postgres, Storage, Edge Functions)
* **Billing**: Lemon Squeezy
* **AI Provider**: Gemini behind an AI provider abstraction
* **Source of Truth**: GitHub repository
* **System Authoritativeness**: Deterministic backend logic is authoritative; LLM outputs are strictly advisory

## Architecture Principles

1. **Deterministic Authority**: All game states, challenges, progression, and financial transactions are resolved deterministically by backend logic.
2. **Advisory AI**: LLM outputs (e.g., character roasts, dialogue, flavor text) never dictate system state or bypass business rules.
3. **Lean Architecture**: No unneeded layers (e.g., no microservices, vector DBs, Redis, queues, GraphQL, or heavy ORMs).
4. **Clean Monorepo**: Separation of concerns between domain abstractions (`packages/domain`) and web presentation (`apps/web`).
