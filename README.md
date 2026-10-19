# MCP Database Doctor

**Catch dangerous PostgreSQL migrations and slow queries before your AI agent ships them — offline, no DB credentials.**

Offline PostgreSQL migration linting and query analysis for AI coding agents. Detects table-locking DDL, dangerous type changes, slow query patterns, and execution plan issues before they reach production. Nothing leaves your machine, no database connection required.

[![npm version](https://img.shields.io/npm/v/mcp-database-doctor?color=blue)](https://www.npmjs.com/package/mcp-database-doctor)
[![npm downloads](https://img.shields.io/npm/dm/mcp-database-doctor)](https://www.npmjs.com/package/mcp-database-doctor)
[![CI status](https://github.com/petrovicistefan/mcp-database-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/petrovicistefan/mcp-database-doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ⚡ Quickstart

### Any MCP Client (one command, no install)

**Claude Code:**

```bash
claude mcp add database-doctor -- npx -y mcp-database-doctor
```

**Cursor, Claude Desktop, Windsurf, Cline, VS Code:**

Add to your MCP config (`~/.cursor/mcp.json`, `claude_desktop_config.json`, etc.):

```json
{
  "mcpServers": {
    "database-doctor": {
      "command": "npx",
      "args": ["-y", "mcp-database-doctor"]
    }
  }
}
```

### Command Line

```bash
# Check a migration file directly (coming soon)
npx mcp-database-doctor check migration.sql

# Use via MCP in your AI client - just ask:
# "Check this migration for dangerous patterns"
# "Review this query for performance issues"
```

**⭐ Star this repository to support the project and stay updated!** → [Give a star](https://github.com/petrovicistefan/mcp-database-doctor)

---

<!-- TODO: Add demo GIF here once generated from docs/demo.tape using VHS -->
<!-- ![Demo: Database Doctor catching a dangerous migration](docs/demo.gif) -->

## 📋 Table of Contents

- [Why Database Doctor?](#why-database-doctor)
- [Use Cases](#use-cases)
- [What It Checks](#what-it-checks)
- [How It Compares](#how-it-compares)
- [Tools](#tools)
- [Example Prompts](#example-prompts)
- [Limitations](#limitations)
- [Development](#development)
- [More MCP Servers by the Author](#more-mcp-servers-by-the-author)
- [Contributing](#contributing)
- [License](#license)

---

## Why Database Doctor?

**The hook:** Your AI agent generates migrations that *look* harmless: `CREATE INDEX`, `ALTER COLUMN ... TYPE`, `ADD COLUMN NOT NULL`. But each one can lock your production table for minutes or hours, block every write, and take down your app.

Database Doctor catches these before they ship:
- **No database required**: Static analysis only, works with uncommitted code
- **No credentials**: Nothing connects to your database or executes SQL
- **No network**: Everything runs locally on your machine
- **AI-native**: Designed for AI coding agents (Claude Code, Cursor, GitHub Copilot)

### When to Use

✅ **Before shipping migrations** — Catch `CREATE INDEX` without `CONCURRENTLY`, dangerous type changes, volatile defaults  
✅ **Reviewing slow queries** — Detect `SELECT *`, deep `OFFSET`, unbounded writes, unindexed predicates  
✅ **Analyzing EXPLAIN plans** — Spot large sequential scans, row estimate errors, sort spills, high loop counts  
✅ **Suggesting indexes** — Get conservative DDL candidates for WHERE clause columns  

---

## Use Cases

### 1. AI Agent Code Review

**Your agent writes the migration. Database Doctor reviews it before committing.**

```
User: "Add an email column to the users table"

Agent writes:
  ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL;

Database Doctor flags:
  ⚠️  NOT_NULL_CHANGE (medium severity)
  Adding NOT NULL requires a full table scan and may hold locks.
  Recommendation: Backfill data first, then add NOT NULL separately.

Agent rewrites:
  ALTER TABLE users ADD COLUMN email VARCHAR(255);
  -- Backfill in application code or batched UPDATE
  ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

### 2. Pre-Commit Checks

**Catch dangerous migrations before they reach CI.**

Ask your AI: *"Check all migrations in `db/migrations/` for safety"*

Database Doctor reviews each file and reports:
- Destructive DDL (DROP, TRUNCATE)
- Blocking index creation
- Table-rewriting column changes
- Constraint validation without NOT VALID
- Transactions that can't hold CONCURRENTLY operations

### 3. Query Optimization

**Find performance issues before they hit production.**

Your agent generates:
```sql
SELECT * FROM orders 
WHERE LOWER(email) = 'user@example.com' 
OFFSET 10000 
LIMIT 20;
```

Database Doctor flags:
- `SELECT_STAR`: Wildcard projection couples schema to caller
- `FUNCTION_PREDICATE`: `LOWER()` may not use an index on `email`
- `DEEP_OFFSET`: Offset 10000 discards many rows, use keyset pagination

### 4. EXPLAIN Plan Review

**Submit a slow query's execution plan for analysis.**

```bash
# On your test database
EXPLAIN (FORMAT JSON) SELECT ... > plan.json

# In your AI client
"Review this execution plan from plan.json"
```

Database Doctor detects:
- Sequential scans on large tables
- Row estimate errors (10x+ off)
- Sort operations spilling to disk
- High loop counts in nested joins

---

## What It Checks

### Migration Safety (`check_migration`)

| Check | Severity | What It Catches |
|-------|----------|-----------------|
| `DESTRUCTIVE_DDL` | High | DROP TABLE/SCHEMA/DATABASE, TRUNCATE |
| `COLUMN_TYPE_CHANGE` | High | ALTER COLUMN ... TYPE (table rewrite + strong locks) |
| `BLOCKING_INDEX` | Medium | CREATE INDEX without CONCURRENTLY (blocks writes) |
| `CONCURRENT_INDEX_TRANSACTION` | High | CONCURRENTLY inside BEGIN/COMMIT (invalid) |
| `UNIQUE_INDEX_DATA` | Medium | UNIQUE index requires compatible existing data |
| `NOT_NULL_CHANGE` | Medium | SET NOT NULL or ADD COLUMN NOT NULL (table scan) |
| `CONSTRAINT_VALIDATION` | Medium | ADD FOREIGN KEY / CHECK without NOT VALID |
| `VOLATILE_DEFAULT` | High | DEFAULT with random(), clock_timestamp(), nextval() |
| `CASCADE` | High | CASCADE can affect dependent objects |

### Query Analysis (`analyze_query`)

| Check | Severity | What It Catches |
|-------|----------|-----------------|
| `SELECT_STAR` | Low | Wildcard projection increases coupling |
| `UNBOUNDED_WRITE` | High | UPDATE/DELETE without WHERE |
| `DEEP_OFFSET` | Medium | Large OFFSET discards rows, use keyset pagination |
| `FUNCTION_PREDICATE` | Medium | Function in WHERE may not use index |
| `UNORDERED_LIMIT` | Low | LIMIT without ORDER BY gives unstable results |
| `CROSS_JOIN` | Medium | Explicit CROSS JOIN multiplies row counts |
| `NULL_NOT_IN` | Medium | NOT IN subquery with NULLs can produce unexpected results |
| `RANDOM_SORT` | Medium | ORDER BY random() can require sorting all rows |

### EXPLAIN Plan Analysis (`explain_plan`)

| Check | Severity | What It Catches |
|-------|----------|-----------------|
| `LARGE_SEQ_SCAN` | Medium | Sequential scan with 10,000+ estimated rows |
| `ROW_ESTIMATE_ERROR` | Medium | Estimated vs actual rows differ by 10x+ |
| `SORT_SPILL` | Medium | Sort spilled to disk (increase work_mem) |
| `HIGH_LOOPS` | Medium | Plan node executes 1000+ loops |

---

## How It Compares

*As of October 2026. All comparisons stated cautiously based on public documentation.*

| Feature | Database Doctor | MigrationPilot | Locksmith | Ballast | DBHub |
|---------|-----------------|----------------|-----------|---------|-------|
| **Offline analysis** | ✅ No DB connection | ✅ Optional | ✅ No DB connection | ❌ Requires DB | ❌ Connects to DB |
| **Migration linting** | ✅ 9 migration rules | ✅ 112 rules | ✅ 9 rules + rewrites | ✅ Superset of Squawk | ❌ Not a linter |
| **Query analysis** | ✅ 8 query patterns | ❌ Migration-only | ❌ Migration-only | ❌ Migration-only | ✅ Via execution |
| **EXPLAIN plan analysis** | ✅ 4 plan checks | ❌ | ❌ | ❌ | ✅ Via EXPLAIN |
| **Index suggestions** | ✅ Conservative candidates | ❌ | ❌ | ❌ | ❌ |
| **MCP server** | ✅ 5 tools | ✅ 4 tools | ✅ 3 tools | ⚠️ Unclear | ✅ Multi-DB gateway |
| **No credentials needed** | ✅ Never connects | ⚠️ Optional | ✅ Never connects | ❌ Requires DSN | ❌ Requires connection |
| **AI agent integration** | ✅ MCP-native | ✅ MCP + CLI | ✅ MCP-native | ⚠️ MCP unclear | ✅ Multi-DB MCP |
| **Auto-fix** | ❌ Recommendations only | ✅ 20 auto-fixes | ✅ Paste-ready rewrites | ⚠️ Unclear | ❌ |
| **PostgreSQL-specific** | ✅ PostgreSQL-first | ✅ PostgreSQL-only | ✅ PostgreSQL-only | ✅ PostgreSQL-only | ❌ Multi-DB |
| **License** | MIT | MIT | MIT | MIT | MIT |

**Our differentiators:**
- **Broadest scope**: migrations + queries + EXPLAIN plans + index suggestions (4 capabilities in one tool)
- **Zero setup**: No database, no credentials, no config — works on uncommitted code
- **Privacy-first**: Completely offline, nothing sent anywhere
- **PostgreSQL-native**: Not regex-based, handles comments, strings, dollar quotes, nested blocks
- **Lightweight**: Zero dependencies beyond MCP SDK and Zod

**When to use alternatives:**
- **MigrationPilot**: Need 112 rules, auto-fix, VS Code extension, GitHub Action with SARIF
- **Locksmith**: Need paste-ready safe rewrites and lock matrix documentation
- **Ballast**: Need load-aware analysis weighted by real table size (requires DB connection)
- **DBHub**: Need to connect to live databases for exploration and guarded SQL execution

---

## Tools

Database Doctor exposes 5 MCP tools for AI agents:

| Tool | Input | Output |
|------|-------|--------|
| `analyze_query` | `sql` (string) | SQL anti-patterns with severity, message, recommendation, statement number |
| `check_migration` | `sql` (string) | Destructive DDL, locking risks, transaction conflicts, constraint validation issues |
| `suggest_indexes` | `sql` (string)<br>`existingIndexes` (optional array) | Conservative index DDL candidates (never applied, requires EXPLAIN validation) |
| `explain_plan` | `plan` (JSON string) | Large scans, row estimate errors, sort spills, high loops |
| `health_report` | `queries` (optional array)<br>`migrations` (optional array)<br>`plans` (optional array) | Aggregate review of supplied artifacts (not live database health) |

**All tools are read-only, idempotent, and require no authentication.**

Reports include:
- `code`: Stable identifier for the finding type
- `severity`: `high`, `medium`, or `low`
- `message`: What the issue is
- `recommendation`: How to fix it
- `statement`: Which statement in multi-statement SQL (1-indexed)

---

## Example Prompts

**For migrations:**
```
"Check this migration for locking issues"
"Review db/migrations/003_add_email_index.sql before I commit"
"Is this ALTER TABLE safe for a production table with 10M rows?"
```

**For queries:**
```
"Analyze this query for performance issues"
"Why is this SELECT slow?"
"Review the queries in src/repositories/user.ts"
```

**For EXPLAIN plans:**
```
"Review this EXPLAIN plan from plan.json"
"What's wrong with this execution plan?"
```

**For index suggestions:**
```
"What indexes would help this query?"
"Suggest indexes for this WHERE clause"
```

**For aggregate review:**
```
"Review all migrations in db/migrations/ for safety"
"Check queries.sql and migrations.sql for issues"
```

**Integration with development workflow:**
```
"Before I commit, check the migration I just generated"
"Add this to pre-commit: check all .sql files for dangerous patterns"
```

---

## Limitations

Database Doctor uses **heuristic static analysis**, not a full PostgreSQL parser or proof of safety.

### What it handles well
✅ Comments (single-line `--` and nested block `/* */`)  
✅ String literals (including escaped `E'...'`)  
✅ Dollar-quoted strings (`$$`, `$tag$`)  
✅ Quoted identifiers (`"column_name"`)  
✅ Common DDL and DML patterns  

### Known limitations
⚠️ **Not a full SQL parser**: Complex CTEs, nested scopes, unusual DDL may produce false positives or missed findings  
⚠️ **No schema metadata**: Can't verify if a column exists, what type it is, or what indexes are present  
⚠️ **Index inference is conservative**: Supports one unquoted table, no joins/subqueries, no composite index optimization  
⚠️ **Stored procedure bodies not analyzed**: SQL inside functions, DO blocks, dynamic strings is not inspected  
⚠️ **No execution**: Can't measure actual query time, lock duration, or real plan costs  
⚠️ **PostgreSQL-first**: Not tested on MySQL, SQL Server, Oracle, or other dialects  

### What findings mean
✅ **Finding detected**: Review the specific pattern before applying  
⚠️ **No findings**: Does NOT mean the SQL is safe, performant, or valid PostgreSQL  
⚠️ **Absence of a finding is not authorization** to run a migration in production  

**Always test migrations on a safe environment before production.**

---

## Development

**Requirements:** Node.js >=22.18 (Node 24 recommended)

```bash
# Install dependencies
npm install

# Type check
npm run check

# Run tests (core logic, no network)
npm test

# Build
npm run build

# Integration tests (MCP stdio after build)
npm run test:integration

# Verify package contents
npm pack --dry-run
```

**Test coverage:** 53 core tests covering:
- SQL masking (comments, strings, dollar quotes, quoted identifiers)
- Query analysis (all 8 rules)
- Migration checks (all 9 rules)
- EXPLAIN plan parsing and analysis
- Index suggestion logic
- Health report aggregation

**CI:** GitHub Actions runs type check, tests, build, integration tests, and package verification on every push and PR.

---

## More MCP Servers by the Author

**Part of the [petrovicistefan MCP suite](https://github.com/petrovicistefan/mcp-marketplace) — local-first guardrails for AI coding agents.**

All tools in this family are:
- ✅ **Local-first**: Everything runs on your machine
- ✅ **Read-only**: No destructive operations (except explicit opt-in)
- ✅ **No API keys**: No accounts, no telemetry, no network calls (unless opted in)
- ✅ **AI-native**: Built specifically for AI coding agents

| Server | Purpose |
|--------|---------|
| [mcp-security-guard](https://github.com/petrovicistefan/mcp-security-guard) | Audit MCP servers for tool poisoning, rug pulls, and leaked secrets (OWASP MCP Top 10) |
| [mcp-cost-optimizer](https://github.com/petrovicistefan/mcp-cost-optimizer) | Detect expensive cloud patterns before they hit production |
| **mcp-database-doctor** | **Catch dangerous PostgreSQL migrations and slow queries (you are here)** |
| [mcp-dependency-doctor](https://github.com/petrovicistefan/mcp-dependency-doctor) | Find outdated dependencies, CVEs, and license issues |
| [mcp-seo-auditor](https://github.com/petrovicistefan/mcp-seo-auditor) | Audit web pages for SEO and accessibility issues |
| [mcp-api-guardian](https://github.com/petrovicistefan/mcp-api-guardian) | Validate REST API designs against best practices |
| [mcp-marketplace](https://github.com/petrovicistefan/mcp-marketplace) | Browse and discover all MCP servers in the family |

---

## Commercial Roadmap

**Free forever:**
- Local query, migration, and EXPLAIN plan analysis
- All 5 MCP tools
- No usage limits
- No telemetry

**Pro tier (planned, opt-in):**
- History tracking (before/after comparisons)
- CI policies and advanced recommendations
- Hosted HTTP API (for non-MCP integrations)
- Quotas via control-plane for hosted path only

**Team tier (planned, opt-in):**
- Shared migration policies
- Centralized reports
- Fleet-wide query analysis

**Local tools stay free and offline forever.** Paid features are additive and require explicit opt-in.

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

**Good first contributions:**
- Add test cases for false positives or missed findings
- Improve documentation and examples
- Add support for more PostgreSQL versions
- Extend query or migration rules

**Not currently accepting:**
- Support for other databases (MySQL, SQL Server, etc.) without a clear use case
- Network-based features (stay local-first)

[Contribution guide](CONTRIBUTING.md) · [Open issues](https://github.com/petrovicistefan/mcp-database-doctor/issues) · [Report a false positive](https://github.com/petrovicistefan/mcp-database-doctor/issues/new)

---

## License

MIT © [Stefan Petrovici](https://github.com/petrovicistefan)

See [LICENSE](LICENSE) for details.

---

## About the Author

I'm Stefan Petrovici: passionate about IT, a husband and a father. I built Database Doctor and the entire MCP suite on my own. **I'm looking for a job.**

I build web applications end to end—frontend, backend, APIs and deployment—and I'm happy to work on anything else that needs building. This repository shows how I work: tests, CI, careful documentation and attention to detail.

I also build WordPress and WooCommerce plugins, available at [pluginsforstores.com](https://pluginsforstores.com).

If your team is hiring, write to me at [hello@petrovicistefan.ro](mailto:hello@petrovicistefan.ro).

---

## ⭐ Support This Project

**Found this useful? [Star this repository](https://github.com/petrovicistefan/mcp-database-doctor)!**

A GitHub star helps other developers discover the project and lets you save it for later. Thanks for supporting open source!

---

*Database Doctor is not affiliated with PostgreSQL, Anthropic, or any other vendor mentioned in this document.*
