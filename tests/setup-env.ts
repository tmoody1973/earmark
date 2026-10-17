// Dummy config so modules that call getEnv() load under test. Only fills what is unset, so CI's real env wins.
process.env.BEE_TOKEN ??= "test-bee-token";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.EARMARK_WEBHOOK_SECRET ??= "test-webhook-secret-0123456789abcdef";
