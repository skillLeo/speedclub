<?php

use App\Enums\ContentEvent;
use App\Models\FeatureFlag;
use App\Services\AppConfig\AppConfig;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Crawl triage (M5.9f): the admin flag list (ADM-36) shows each flag's description. FeatureFlagSeeder never changes an existing row, so
 * this brings existing hosts in line with database/data/feature_flags.json, and only where staff never wrote their own text:
 * - a flag without a description (null or empty: the M4.11 flags build_reactions, mentions, collections, vehicle_follow and
 *   build_comments were inserted before the file had their texts) gets the file's text;
 * - `sticker_shop` still reading the seeded text that named a config key gets the reworded one.
 * Any other text is staff's and stays. Audited `flag.changed` by the system per row; running it again finds nothing to change.
 */
return new class extends Migration
{
    /** @var array<string, string> key => the text the seeder wrote before the rewording */
    public const OLD = [
        'sticker_shop' => 'Link "Sticker bestellen" zum externen Shop (links.sticker_shop in der Remote-Config); aus, bis der Shop steht',
    ];

    public const REASON = 'Beschreibung aus database/data/feature_flags.json übernommen (Crawl-Triage M5.9f).';

    public function up(): void
    {
        $this->refresh();
    }

    /**
     * @return list<string> the keys whose description changed
     */
    public function refresh(): array
    {
        /** @var array<string, string> $texts */
        $texts = json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true, flags: JSON_THROW_ON_ERROR);
        $changed = [];

        foreach ($texts as $key => $text) {
            $done = DB::transaction(function () use ($key, $text): bool {
                $flag = FeatureFlag::query()->where('key', $key)->lockForUpdate()->first();

                if (! $flag instanceof FeatureFlag) {
                    return false;
                }

                $current = $flag->getAttribute('description');
                $empty = ! is_string($current) || trim($current) === '';

                if ($current === $text || ! ($empty || (isset(self::OLD[$key]) && $current === self::OLD[$key]))) {
                    return false;
                }

                $flag->forceFill(['description' => $text])->save();
                Audit::record(ContentEvent::FlagChanged->value, $flag,
                    before: ['key' => $key, 'description' => $current],
                    after: ['key' => $key, 'description' => $text],
                    reason: self::REASON);

                return true;
            });

            if ($done) {
                $changed[] = $key;
            }
        }

        if ($changed !== []) {
            app(AppConfig::class)->flush();
        }

        return $changed;
    }

    public function down(): void
    {
        // Descriptions are text for staff; nothing to restore.
    }
};
