<?php

namespace Database\Seeders;

use App\Models\FeatureFlag;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;

/**
 * 02_PRODUCT_SPEC §5 and §6: sig.* is on outside production and off in production, ai.* is off everywhere. Phase 4 flags with the
 * same "on · on · off" default (09 §8 table) are listed in ON_OUTSIDE_PRODUCTION. Existing flags keep their state, so running this
 * again never undoes a change in the admin, and a flag added later reaches an existing host with `db:seed --class=FeatureFlagSeeder`.
 */
class FeatureFlagSeeder extends Seeder
{
    use SeedsFromData;

    /**
     * Signature flags that stay off in every environment until their feature is built. Turning one on would show half a
     * feature on one surface only.
     *
     * @var array<string, string> key => why
     */
    public const OFF_UNTIL_BUILT = [
        // Empty since M2.7 built the legal status of mods (ADR-153 lifted; data update 2026_11_13_170100).
    ];

    /**
     * Flags outside sig.* that start on for local and staging and off in production (09 §8 table).
     *
     * @var array<string, string> key => why
     */
    public const ON_OUTSIDE_PRODUCTION = [
        'editorial_samples' => '09 §8.19: sample content only on local and staging until the client supplies real, consented builds',
        'auth.passkeys' => '09 §8.18: production only after the real-device check',
        'events' => '09 §8.18: events and meets (M4.12); production after the client signed off the event rules',
        'events.create' => '09 §8.18: members create events (M4.12); production after the client signed off the event rules',
        'app_icons' => '09 §8.18: alternate app icons (M4.13); production after the store builds carry them',
        'qr_milestone' => 'M4.9: the QR milestone moment (scan marks of a sticker); production with the release that ships it',
    ];

    /**
     * Not listed anywhere, so off in every environment: `businesses` (M4.14 not built yet), `membership` (09 §8.18: off, no billing) and
     * `msg_replies` (ADR-445, ADR-450: the API stores replies, the app turns them on),
     * besides the off-by-default ones above (build_comments, sticker_shop, premium.enabled, auth.apple, auth.google).
     *
     * Flags that start on in every environment (09 §8 table "on · on · on"). auth.apple and auth.google start off everywhere until the
     * owner supplies the client IDs (OA-15, OA-26).
     *
     * @var array<string, string> key => why
     */
    public const ON_EVERYWHERE = [
        'auth.email_code' => '09 §8.1: the e-mail code is the own-account path that always works',
        'auth.password_login' => '09 §8.1: existing accounts keep their password',
        'nav.native_tabs' => '09 §8.18: on everywhere, a kill switch back to the JS tab bar (M4.5)',
        'build_reactions' => '09 §8.18: private reactions, counts for the owner only (M4.11, ADR-413)',
        'mentions' => '09 §8.18: mentions with the member\'s "Wer darf mich erwähnen" choice (M4.11)',
        'collections' => '09 §8.18: private collections replace the single saved list (M4.11)',
        'vehicle_follow' => '09 §8.18: follow a build without following the person (M4.11)',
        'maintenance' => '09 §8.18: maintenance, service log and reminders (M4.13)',
        'theme_reveal' => '09 §8.18: the animated theme change SM14 (M4.13), a kill switch back to an instant change',
    ];

    /**
     * @return array<string, string>
     */
    private function offUntilBuilt(): array
    {
        return self::OFF_UNTIL_BUILT;
    }

    public function run(): void
    {
        /** @var array<string, string> $flags */
        $flags = $this->readJson('feature_flags.json');
        $production = app()->environment('production');

        foreach ($flags as $key => $description) {
            FeatureFlag::query()->firstOrCreate(['key' => $key], [
                'enabled' => array_key_exists($key, self::ON_EVERYWHERE) || (! $production
                    && ! array_key_exists($key, $this->offUntilBuilt())
                    && (str_starts_with($key, 'sig.') || array_key_exists($key, self::ON_OUTSIDE_PRODUCTION))),
                'description' => $description,
            ]);
        }
    }
}
