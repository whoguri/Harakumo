# Architecture

See the [README](../README.md#architecture) for the diagram, module map and design decisions.

Summary: Next.js App Router route handlers are the only code that talks to Harakumo, through a single server-only `@harakumo/sdk` client (`src/lib/harakumo.ts`). Resource payloads are normalised through allow-lists (`src/lib/resources.ts`) before they reach the browser. The assistant (`src/lib/planner.ts`) proposes plans via the Harakumo AI Gateway or a deterministic fallback; plans are stored and executed only after explicit approval. Metadata lives in a Harakumo edge SQLite database with ordered migrations (`src/lib/store`).
