<?php

use App\Enums\ApprovalStatus;
use App\Enums\ContentEvent;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * R4B-009 (client round 4 hunt): the brand is "Speedclub" since client round 2 (2026_12_31_400000), but the legal texts kept "SPEED
 * CLUB" (Datenschutz, AGB, Impressum, Community-Richtlinien, Lizenzen: published versions are history and the rename left them).
 *
 * - Live texts: for every document and locale whose current published text still writes the old name, a new version is published with
 *   exactly that text and only the name changed — a text staff edited in ADM-31 keeps the edit.
 * - Scheduled versions (published in the future): a renamed copy is scheduled at the same time (the newer row wins then), with an
 *   audit row; the original stays as history.
 * - Drafts (ADM-31): a draft started from the version this migration replaced is re-based on the new one, so it stays publishable
 *   (LegalDrafts::staleness). Its text is renamed too — unless a four-eyes re-consent approval for it is pending: that approval pins the
 *   text (PublishLegalDocument::pins), so the text stays as the approver read it and staff rename it in ADM-31 afterwards.
 *
 * No re-consent: a spelling of the product name changes no right or duty (requires_reconsent stays off, as in 2026_12_21_100000).
 * Published by the system and audited as `legal.published`. Running it again finds nothing to rename; a fresh install gets the renamed
 * data files (database/data/legal) from the seeder. Review SF-8 (docs/reports/round-4/review-server.md).
 */
return new class extends Migration
{
    private const OLD = ['SPEED CLUB', 'SPEED-CLUB', "SPEED-\u{2060}CLUB", 'Speed Club', 'Speed club'];

    public const REASON = 'Name einheitlich als „Speedclub“ geschrieben. Inhalt unverändert; keine erneute Zustimmung.';

    public function up(): void
    {
        if (! DB::getSchemaBuilder()->hasTable('legal_documents')) {
            return;
        }

        /** @var array<int, int> $replaced replaced live version id => its renamed successor */
        $replaced = [];
        $pairs = LegalDocument::query()->select(['key', 'locale'])->distinct()->get();

        foreach ($pairs as $pair) {
            $replaced += $this->renameCurrent((string) $pair->getRawOriginal('key'), (string) $pair->locale);
        }

        $scheduled = $this->renameScheduled();
        $this->renameDrafts($replaced);

        if ($replaced !== [] || $scheduled > 0) {
            app(AppConfig::class)->flush();
        }
    }

    /** Published texts are history (a member may have read one); nothing is taken back. */
    public function down(): void {}

    public static function renamed(string $text): string
    {
        return str_replace(self::OLD, 'Speedclub', $text);
    }

    /**
     * @return array<int, int> the replaced live version's id => the new version's id (empty when nothing was renamed)
     */
    private function renameCurrent(string $key, string $locale): array
    {
        return DB::transaction(function () use ($key, $locale): array {
            $versions = LegalDocument::query()->where('key', $key)->where('locale', $locale)->lockForUpdate()->get();
            $current = $versions
                ->filter(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at->lessThanOrEqualTo(now()))
                ->sortByDesc(fn (LegalDocument $row): string => $row->published_at?->format('Y-m-d H:i:s.u').sprintf('%020d', $row->id))
                ->first();

            if ($current === null) {
                return [];
            }

            $body = self::renamed($current->body_md);

            if ($body === $current->body_md) {
                return [];
            }

            $document = $this->publishCopy($current, $body, now(), array_values($versions->map(fn (LegalDocument $row): string => $row->version)->all()));

            return [$current->id => $document->id];
        });
    }

    /** Future versions: a renamed copy at the same time, audited; the original stays. Returns how many were copied. */
    private function renameScheduled(): int
    {
        $copied = 0;

        LegalDocument::query()->whereNotNull('published_at')->where('published_at', '>', now())->get()
            ->each(function (LegalDocument $row) use (&$copied): void {
                $body = self::renamed($row->body_md);

                if ($body === $row->body_md || $row->published_at === null) {
                    return;
                }

                DB::transaction(function () use ($row, $body, &$copied): void {
                    $taken = LegalDocument::query()->where('key', $row->getRawOriginal('key'))->where('locale', $row->locale)->lockForUpdate()->pluck('version')->all();
                    $this->publishCopy($row, $body, $row->published_at, array_values(array_map('strval', $taken)));
                    $copied++;
                });
            });

        return $copied;
    }

    /**
     * @param  array<int, int>  $replaced
     */
    private function renameDrafts(array $replaced): void
    {
        $pinned = ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->where('status', ApprovalStatus::Pending)->get()
            ->map(fn (ApprovalRequest $request): int => (int) ($request->payload['document_id'] ?? 0))
            ->filter()
            ->all();

        LegalDocument::query()->whereNull('published_at')->get()->each(function (LegalDocument $draft) use ($replaced, $pinned): void {
            $changes = [];
            $base = $draft->getAttribute('based_on_id');

            if (is_int($base) && array_key_exists($base, $replaced)) {
                $changes['based_on_id'] = $replaced[$base];
            }

            $body = self::renamed($draft->body_md);

            if ($body !== $draft->body_md && ! in_array($draft->id, $pinned, true)) {
                $changes['body_md'] = $body;
            }

            if ($changes !== []) {
                $draft->forceFill($changes)->save();
            }
        });
    }

    /**
     * @param  list<string>  $taken
     */
    private function publishCopy(LegalDocument $from, string $body, DateTimeInterface $at, array $taken): LegalDocument
    {
        $version = $this->nextVersion($from->version, $taken);
        $key = (string) $from->getRawOriginal('key');
        $document = LegalDocument::query()->create([
            'key' => $key,
            'locale' => $from->locale,
            'version' => $version,
            'body_md' => $body,
            'requires_reconsent' => false,
            'summary' => null,
            'published_at' => $at,
            'reason' => self::REASON,
        ]);

        Audit::record(ContentEvent::LegalPublished->value, $document,
            before: ['key' => $key, 'locale' => $from->locale, 'version' => $from->version],
            after: ['key' => $key, 'locale' => $from->locale, 'version' => $version, 'requires_reconsent' => false, 'summary' => null, 'body_sha256' => hash('sha256', $body)],
            reason: self::REASON);

        return $document;
    }

    /**
     * @param  list<string>  $taken
     */
    private function nextVersion(string $current, array $taken): string
    {
        $number = ctype_digit($current) ? (int) $current + 1 : count($taken) + 1;

        while (in_array((string) $number, $taken, true)) {
            $number++;
        }

        return (string) $number;
    }
};
