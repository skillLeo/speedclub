/**
 * M5.12a (09 §12, ADR-473): app code imports each primitive from its own module (`@/ui/Button`), never through the `@/ui` barrel, which
 * made every member-web route chunk depend on all primitives. scripts/split-ui-imports.mjs rewrites a barrel import; this keeps it so.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

describe('the @/ui barrel', () => {
  it('is not imported by app code', () => {
    expect(() => execFileSync('node', ['scripts/split-ui-imports.mjs', '--check'], { cwd: join(__dirname, '..', '..'), stdio: 'pipe' })).not.toThrow();
  });
});
