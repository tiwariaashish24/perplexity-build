# Backend

The Express API serves authenticated conversation history, OpenAI answers, and
optional Tavily web search on port `3000`.

## Configuration

Copy `.env.example` to `.env` and provide:

- `DATABASE_URL` — PostgreSQL connection string used by Prisma.
- `SUPABASE_API_SECRET` — server-side Supabase key used to verify access tokens.
- `OPENAI_API_KEY` — OpenAI API key for answer generation.
- `TAVILY_API_KEY` — Tavily API key for web search (required when Web is on).

Keep `.env` private; do not commit it or put server-side keys in the frontend.

## Run

```bash
bun install
bun run index.ts
```

The frontend connects to `http://localhost:3000`. Check `GET /health` to confirm
the API and PostgreSQL connection are available.

Search requests accept a `model` (`gpt-4o-mini`, `gpt-4.1-mini`, or `gpt-4.1`)
and a `webSearch` boolean. Web search is enabled by default.
