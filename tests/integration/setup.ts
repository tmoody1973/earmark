// Point every db() call at the Neon `test` branch. Without TEST_DATABASE_URL, drop DATABASE_URL so nothing
// can reach production; the suites then skip themselves.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
