// vitest doesn't set the "react-server" condition the real "server-only" package checks for,
// so it throws on import outside Next.js. Aliased in here (vitest.config.ts) for unit tests
// that import server-side lib/ai modules for their pure logic, not to run Next.js server code.
export {};
