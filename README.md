# Claude Code Start Here

> **Before making any edits**, read these files in order:
> 1. [`docs/claude/PROJECT_MEMORY.md`](docs/claude/PROJECT_MEMORY.md)
> 2. [`docs/claude/TODO_NEXT.md`](docs/claude/TODO_NEXT.md)

---

# تشريع — Arabic Legal Platform

منصة بحث قانوني عربية شاملة تضم الأنظمة السعودية والأحكام القضائية وكشاف أم القرى.

## Quick Start

```bash
npm ci
npm run dev    # http://localhost:3005
```

## Stack

- **Backend:** Express.js + SQLite (better-sqlite3) + FTS5
- **Frontend:** React + Vite + TanStack Query + Tailwind CSS + shadcn/ui
- **Auth:** Custom JWT + Google OAuth 2.0
- **Deploy:** Render.com (migrating to Hetzner VPS)
