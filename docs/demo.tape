# VHS demo for mcp-database-doctor
# Shows a dangerous migration being caught

Output docs/demo.gif

Require echo

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set TypingSpeed 50ms
Set Theme "Catppuccin Mocha"

Type "# Database Doctor demo: catch a dangerous migration before it ships"
Sleep 500ms
Enter
Sleep 500ms

Type "# Let's check a migration that looks innocent but will lock your production table"
Sleep 500ms
Enter
Sleep 500ms

Type 'cat > migration.sql << EOF'
Enter
Type 'BEGIN;'
Enter
Type 'ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;'
Enter
Type 'CREATE INDEX idx_users_email ON users(email);'
Enter
Type 'COMMIT;'
Enter
Type 'EOF'
Enter
Sleep 1s

Type "npx -y mcp-database-doctor check_migration migration.sql"
Enter
Sleep 3s

Type "# ⚠️  Database Doctor caught 3 dangerous patterns:"
Sleep 500ms
Enter
Type "# 1. NOT_NULL_CHANGE - requires full table scan"
Sleep 500ms
Enter
Type "# 2. BLOCKING_INDEX - normal CREATE INDEX blocks all writes"
Sleep 500ms
Enter
Type "# 3. VOLATILE_DEFAULT - may trigger table rewrite"
Sleep 1s
Enter
Sleep 500ms

Type "# Your AI agent now knows to rewrite this safely"
Sleep 500ms
Enter
Sleep 500ms

Type 'cat > migration_safe.sql << EOF'
Enter
Type '-- Safe version: add column without default, backfill, then add index concurrently'
Enter
Type 'ALTER TABLE users ADD COLUMN email_verified BOOLEAN;'
Enter
Type 'UPDATE users SET email_verified = FALSE WHERE email_verified IS NULL;'
Enter
Type 'ALTER TABLE users ALTER COLUMN email_verified SET NOT NULL;'
Enter
Type 'ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE;'
Enter
Type 'CREATE INDEX CONCURRENTLY idx_users_email ON users(email);'
Enter
Type 'EOF'
Enter
Sleep 1s

Type "npx -y mcp-database-doctor check_migration migration_safe.sql"
Enter
Sleep 2s

Type "# ✅ Clean! Ready to ship"
Sleep 1s
Enter
Sleep 1s
