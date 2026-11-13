// scripts/design-lint.mjs (09 §14.4) against a throw-away checkout (`--root`): a keyed allowlist entry (DQ-814) exempts one JSON member
// and nothing else of the file, and a broken entry is a configuration error, never a silent exemption. No browser, no server.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '../support/fixtures';

const LINT = fileURLToPath(new URL('../../../../scripts/design-lint.mjs', import.meta.url));
const exec = promisify(execFile);
const LOCALE = 'mobile/src/i18n/locales/de/garage.json';

type Violation = { file: string; line: number; rule: string; match: string };
type Report = { total: number; failing: number; violations: Violation[] };

/** The garage locale as the app has it, plus the same word in another key and in another value. */
const garage = {
  specs: {
    aspirations: { turbo: 'Turbo', supercharged: 'Kompressor', twincharged: 'Turbo + Kompressor' },
  },
  mods: { supercharged: 'Kompressor nachgerüstet' },
  promo: { title: 'Supercharged deine Garage' },
};

const checkout = (root: string, allowlist: object[], locale: string = JSON.stringify(garage, null, 2)) => {
  for (const [file, content] of [
    [LOCALE, locale],
    ['design/lint-allowlist.json', JSON.stringify(allowlist, null, 2)],
  ] as const) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
};

/** Runs the lint on `root`; no baseline there, so every violation counts. */
const lint = (root: string): Promise<{ code: number; report: Report | null; stderr: string }> =>
  exec(process.execPath, [LINT, '--root', root, '--json'], { timeout: 60_000 }).then(
    ({ stdout }) => ({ code: 0, report: JSON.parse(stdout) as Report, stderr: '' }),
    (e: { code: number; stdout: string; stderr: string }) => ({
      code: e.code,
      report: e.code === 1 ? (JSON.parse(e.stdout) as Report) : null,
      stderr: e.stderr,
    }),
  );

const lineOf = (text: string, needle: string): number => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
const keyed = (keys: string[], file = LOCALE) => ({ file, keys, rules: ['DL09'], reason: 'engine-aspiration enum value, not marketing copy' });

test.describe('design-lint: keyed allowlist entries (DQ-814)', () => {
  test('the word in the allowed key passes; the same word in any other key or value of the file is DL09', async ({}, testInfo) => {
    const root = testInfo.outputPath('checkout');
    checkout(root, [keyed(['/specs/aspirations/supercharged'])]);
    const text = JSON.stringify(garage, null, 2);
    const { code, report } = await lint(root);
    expect(code).toBe(1);
    const dl09 = (report?.violations ?? []).filter((v) => v.rule === 'DL09' && v.file === LOCALE).map((v) => v.line).sort((a, b) => a - b);
    const allowedLine = lineOf(text, '"supercharged": "Kompressor"');
    expect(allowedLine).toBeGreaterThan(0);
    expect(dl09).not.toContain(allowedLine);
    expect(dl09).toEqual([lineOf(text, '"supercharged": "Kompressor nachgerüstet"'), lineOf(text, 'Supercharged deine Garage')]);
  });

  test('without the entry the allowed key is reported too: the rule itself is unchanged', async ({}, testInfo) => {
    const root = testInfo.outputPath('checkout');
    checkout(root, []);
    const { report } = await lint(root);
    expect((report?.violations ?? []).filter((v) => v.rule === 'DL09')).toHaveLength(3);
  });

  test('a whole-file entry (no keys) still exempts the whole file', async ({}, testInfo) => {
    const root = testInfo.outputPath('checkout');
    checkout(root, [{ file: LOCALE, rules: ['DL09'], reason: 'whole file, the old form of an entry' }]);
    const { code, report } = await lint(root);
    expect(code).toBe(0);
    expect(report?.violations.filter((v) => v.rule === 'DL09')).toEqual([]);
  });

  test('a minified file: the exemption is the member\'s span, not its line, and the exempt word hides no later one', async ({}, testInfo) => {
    const root = testInfo.outputPath('checkout');
    checkout(root, [keyed(['/specs/aspirations/supercharged'])], JSON.stringify(garage));
    const { report } = await lint(root);
    // Three occurrences on one line: the allowed key, the other key ("supercharged") and the other value ("Supercharged").
    expect((report?.violations ?? []).filter((v) => v.rule === 'DL09').map((v) => v.match)).toEqual(['supercharged', 'Supercharged']);
  });

  test('a pointer the file does not have, keys on a non-JSON file, an empty key list or an unknown rule is a configuration error', async ({}, testInfo) => {
    const cases: Record<string, object> = {
      'missing member': keyed(['/specs/aspirations/kompressor']),
      'not JSON': keyed(['/x'], 'web/resources/css/app.css'),
      'empty keys': keyed([]),
      'not a pointer': keyed(['specs.aspirations.supercharged']),
      'unknown rule': { file: LOCALE, rules: ['DL99'], reason: 'a rule that does not exist' },
    };
    for (const [name, entry] of Object.entries(cases)) {
      const root = testInfo.outputPath(name.replace(/\s+/g, '-'));
      checkout(root, [entry]);
      const { code, stderr } = await lint(root);
      expect(code, name).toBe(2);
      expect(stderr, name).toContain('configuration error');
    }
  });
});
