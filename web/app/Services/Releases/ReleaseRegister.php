<?php

namespace App\Services\Releases;

use App\Enums\ContentEvent;
use App\Enums\ReleaseChannel;
use App\Enums\ReleasePlatform;
use App\Enums\ReleaseSource;
use App\Models\Release;
use App\Services\Audit\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The build entries of docs/RELEASES.md (written by scripts/build-apk.ps1, completed by the release engineer) as release register rows
 * (ADM-38). A build entry is a heading `## <version> (Build <code>) - <channel> - <YYYY-MM-DD HH:MM>` (Europe/Berlin) followed by
 * `- APK:` (platform android), `- SHA-256: <64 hex>` and `- Changes: …` lines. Other sections (the tester summaries "## 0.2.0 — Phase 2")
 * are not builds and are skipped.
 *
 * sync() is idempotent by version + build + channel (+ platform): it creates missing rows, updates rows whose SHA-256, notes or date
 * changed, and leaves equal rows alone. When the file lists the same key twice, the later entry wins (counted as `duplicates`).
 */
final class ReleaseRegister
{
    private const HEADING = '/^## (\d+\.\d+\.\d+) \(Build (\d+)\) - (lan|staging|production) - (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/m';

    /**
     * @return list<array{version_name: string, version_code: int, channel: string, platform: string, apk_sha256: string|null, notes: string|null, released_at: string}>
     */
    public function parse(string $markdown): array
    {
        $markdown = str_replace("\r\n", "\n", $markdown);
        $count = preg_match_all(self::HEADING, $markdown, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        $entries = [];

        for ($i = 0; $i < $count; $i++) {
            $match = $matches[$i];
            $start = $match[0][1] + strlen($match[0][0]);
            $next = strpos($markdown, "\n## ", $start);
            $body = substr($markdown, $start, $next === false ? null : $next - $start);

            preg_match('/^- SHA-256: `?([0-9A-Fa-f]{64})`?/m', $body, $sha);

            $entries[] = [
                'version_name' => $match[1][0],
                'version_code' => (int) $match[2][0],
                'channel' => $match[3][0],
                'platform' => preg_match('/^- (\*\*)?(Release )?APK/mi', $body) === 1 ? ReleasePlatform::Android->value : ReleasePlatform::Web->value,
                'apk_sha256' => isset($sha[1]) ? strtoupper($sha[1]) : null,
                'notes' => $this->notes($body),
                'released_at' => Carbon::createFromFormat('Y-m-d H:i', $match[4][0], 'Europe/Berlin')?->utc()->toIso8601ZuluString() ?? '',
            ];
        }

        return $entries;
    }

    /**
     * @return array{created: int, updated: int, unchanged: int, duplicates: int}
     */
    public function sync(string $markdown): array
    {
        $byKey = [];
        $duplicates = 0;

        foreach ($this->parse($markdown) as $entry) {
            $key = implode('|', [$entry['version_name'], $entry['version_code'], $entry['channel'], $entry['platform']]);
            $duplicates += isset($byKey[$key]) ? 1 : 0;
            $byKey[$key] = $entry;
        }

        $result = ['created' => 0, 'updated' => 0, 'unchanged' => 0, 'duplicates' => $duplicates];

        DB::transaction(function () use ($byKey, &$result): void {
            foreach ($byKey as $entry) {
                $row = Release::query()
                    ->where('version_name', $entry['version_name'])->where('version_code', $entry['version_code'])
                    ->where('channel', $entry['channel'])->where('platform', $entry['platform'])
                    ->lockForUpdate()->first();
                $values = [
                    'apk_sha256' => $entry['apk_sha256'],
                    'notes' => $entry['notes'],
                    'released_at' => Carbon::parse($entry['released_at']),
                ];

                if ($row === null) {
                    Release::query()->create([
                        'version_name' => $entry['version_name'],
                        'version_code' => $entry['version_code'],
                        'channel' => ReleaseChannel::from($entry['channel']),
                        'platform' => ReleasePlatform::from($entry['platform']),
                        'source' => ReleaseSource::Sync,
                        ...$values,
                    ]);
                    $result['created']++;

                    continue;
                }

                $row->fill($values);

                if ($row->isDirty()) {
                    $row->save();
                    $result['updated']++;
                } else {
                    $result['unchanged']++;
                }
            }

            if ($result['created'] + $result['updated'] > 0) {
                Audit::record(ContentEvent::ReleasesSynced->value, after: $result);
            }
        });

        return $result;
    }

    private function notes(string $body): ?string
    {
        // DQ-647: the whole bullet with its lead-in ("Changes since Build 3: …"), so the note never starts mid-sentence.
        if (preg_match('/^- (Changes[^:]*:.*?)(?=^- (Known issues|Test status|Signed by|API)|\z)/msi', $body, $match) !== 1) {
            return null;
        }

        $notes = trim(preg_replace('/[ \t]+/', ' ', $match[1]) ?? '');

        return $notes === '' ? null : Str::limit($notes, 4000, '…');
    }

    /**
     * DQ-614: the note in one line for the register: its first sentence ("Changes since Build 3: the last M2.8 QA fixes."), without
     * Markdown marks, at most 160 characters. The full note stays in `notes` for the drawer.
     */
    public static function summary(?string $notes): ?string
    {
        if ($notes === null || trim($notes) === '') {
            return null;
        }

        $plain = trim((string) preg_replace(['/^\s*[-*]\s+/', '/`([^`]*)`/', '/\*\*([^*]*)\*\*/', '/\s+/'], ['', '$1', '$1', ' '], $notes));
        $first = preg_match('/^(.+?[.!?])(\s|$)/u', $plain, $match) === 1 ? $match[1] : $plain;

        return Str::limit($first, 160, '…');
    }
}
