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
        'web_push' => '09 §8.18: browser notifications of the member web (M4.15); staging sends only once VAPID keys exist (OA-32)',
        'android_widget' => '09 §8.18: the Android home-screen widget "Mein Auto" (09 §8.14, M4.18); production with the store build that carries it',
        'wrapped' => 'M5.9e Season Wrapped (10 §16.5): production from the first release (Saisonende 2027), set with wrapped.releases',
        'wrapped.countdown' => 'M5.9e: the Home countdown banner before a Wrapped release; production with the first release',
        'shop' => 'M5.5 Shop (10 §3, ADR-502/519): the SHOP-01/02 catalogue; production once the client\'s Shopify store and real products exist (OA-44)',
        'build_comments' => '11 R4-2.2: comments under updates, moderated; production after the client\'s OK',
        'crews' => '11 R4-2.3 Crews; production after the client signed off the crew rules',
        'cotd_voting' => '11 R4-2.1 Car of the Day voting; production after the client signed off the voting rules',
    ];

    /**
     * Not listed anywhere, so off in every environment: `businesses` and `parts_catalogue` (M4.14, until its review passed; then
     * on · on · off per 09 §8.18), `affiliate_links` (09 §8.18: off), `membership` (09 §8.18: off, no billing) and
     * `msg_replies` (ADR-445, ADR-450: the API stores replies, the app turns them on),
     * `events.gallery` and `events.checkin` (M5.6, m5.6-contract §3: off by default everywhere, staff switch them on for QA on staging),
     * besides the off-by-default ones above (sticker_shop, premium.enabled, auth.apple, auth.google).
     *
     * Flags that start on in every environment (09 §8 table "on · on · on"). auth.apple and auth.google start off everywhere until the
     * owner supplies the client IDs (OA-15, OA-26).
     *
     * @var array<string, string> key => why
     */
    public const ON_EVERYWHERE = [
        'auth.email_code' => '09 §8.1: the e-mail code is the own-account path that always works; off only on a host that cannot deliver mail yet (staging before SMTP, ADR-520): sign-in by code closes and the app offers the password',
        'auth.password_login' => '09 §8.1: existing accounts keep their password',
        'nav.native_tabs' => '09 §8.18: on everywhere, a kill switch back to the JS tab bar (M4.5)',
        'build_reactions' => '09 §8.18: private reactions, counts for the owner only (M4.11, ADR-413)',
        'mentions' => '09 §8.18: mentions with the member\'s "Wer darf mich erwähnen" choice (M4.11)',
        'collections' => '09 §8.18: private collections replace the single saved list (M4.11)',
        'vehicle_follow' => '09 §8.18: follow a build without following the person (M4.11)',
        'maintenance' => '09 §8.18: maintenance, service log and reminders (M4.13)',
        'theme_reveal' => '09 §8.18: the animated theme change SM14 (M4.13), a kill switch back to an instant change',
        'forum' => 'M5.8 Forum (10 §7, ADR-506): on in every environment; moderated (pre-moderation, keyword rules, DSA reports)',
        'insights' => 'M5.7 (10 §6.1): anonymous view counting and the owner-only INS-01; off means nothing is counted at all',
        'build_prompts' => 'M5.7 (10 §6.2): the target-month prompt of a planned mod, at most once a week, own SET-09 switch',
        'weekly_recap' => 'M5.7 (10 §6.3): the Sunday recap, own SET-09 switches (push, web push, e-mail), skipped when nothing happened',
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
