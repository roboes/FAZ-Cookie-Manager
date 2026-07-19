import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These integration specs activate/deactivate real plugins and rewrite shared
// WordPress options. Playwright workers are separate processes, so an in-memory
// mutex cannot stop two files from changing the same installation at once.
const scope = createHash('sha1')
  .update(process.env.WP_PATH ?? process.env.WP_BASE_URL ?? 'faz-e2e-default')
  .digest('hex')
  .slice(0, 12);
const LOCK_DIR = join(tmpdir(), `faz-e2e-shared-wordpress-${scope}.lock`);

const STALE_MS = 15 * 60_000;
const POLL_MS = 100;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function acquireSharedWordPressLock(timeoutMs = 20 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      return;
    } catch {
      try {
        if (Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_MS) {
          rmSync(LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring shared WordPress E2E lock: ${LOCK_DIR}`);
      }
      await sleep(POLL_MS);
    }
  }
}

export function releaseSharedWordPressLock(): void {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}
