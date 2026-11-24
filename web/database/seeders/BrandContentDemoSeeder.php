<?php

namespace Database\Seeders;

use App\Actions\Admin\Config\SaveConfigDraft;
use App\Actions\Admin\Config\SyncReleases;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Actions\Admin\Content\SaveMessageTemplate;
use App\Enums\BrandAssetKind;
use App\Enums\ConfigKey;
use App\Enums\LegalDocumentKey;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\BrandAsset;
use App\Models\ConfigVersion;
use App\Models\LegalDocument;
use App\Models\MessageTemplate;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Brand\BrandAssets;
use App\Services\Config\ConfigVersions;
use App\Services\Config\Schemas\BrandingSchema;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use Database\Seeders\Concerns\SeedClock;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * M3.5 demo content of the brand, content and configuration admin (ADM-28…38), through the same Actions the pages use: a published
 * home curation (three featured builds, one of them scheduled) and announcements (one ended, one scheduled months ahead), an
 * announcements draft by the content editor (so ADM-30, ADM-34 and ADM-35 show a draft), a Datenschutz draft asking for renewed consent (ADM-31, on the current data file: privacyDraft()), one
 * template override (ADM-33) and the release register from database/data/demo-releases.md (ADM-38, the builds up to 0.2.0 Build 4). Idempotent: a key that already has versions is
 * left alone. Needs the demo staff accounts of StaffSeeder (local/staging) and the demo vehicles.
 */
class BrandContentDemoSeeder extends Seeder
{
    public function run(?CarbonImmutable $now = null): void
    {
        $now ??= DemoSeeder::clock();
        // DQ-677: every step at its own fixed moment, never the wall clock. Locally the team works on after the story's NOW (the install
        // moment of ConfigSeeder v1, the staff accounts and the legal texts) and before the QA clock (02.11.); a host that seeds at its own
        // hour (staging) dates the same steps in the three days before it, never in its future.
        $start = app()->environment('staging') ? $now->subDays(3) : $now;
        $at = fn (int $hours, int $minutes = 0): CarbonImmutable => $start->addHours($hours)->addMinutes($minutes);
        $owner = Staff::query()->role('owner', StaffSeeder::GUARD)->orderBy('id')->first();
        $editor = Staff::query()->where('email', 'content-editor@speedclub.test')->first();

        if (! $owner instanceof Staff || ! $editor instanceof Staff) {
            return;
        }

        $versions = app(ConfigVersions::class);
        $vehicles = Vehicle::query()->where('status', VehicleStatus::Published)->where('visibility', Visibility::Public)
            ->orderByDesc('published_at')->orderBy('id')->limit(3)->pluck('id')->all();

        if (! ConfigVersion::query()->where('key', ConfigKey::HomeCuration->value)->exists() && count($vehicles) === 3) {
            $draft = SeedClock::at($at(2), fn () => app(SaveConfigDraft::class)->handle($owner, ConfigKey::HomeCuration, [
                'featured' => [
                    ['vehicle_id' => $vehicles[0], 'starts_at' => null, 'ends_at' => null],
                    ['vehicle_id' => $vehicles[1], 'starts_at' => $now->subDays(3)->startOfDay()->toIso8601String(), 'ends_at' => $now->addDays(11)->startOfDay()->toIso8601String()],
                    ['vehicle_id' => $vehicles[2], 'starts_at' => $now->addDays(14)->startOfDay()->toIso8601String(), 'ends_at' => null],
                ],
                'collections' => $versions->startingPayload(ConfigKey::HomeCuration)['collections'] ?? [],
            ], null));
            SeedClock::at($at(2, 12), fn () => $versions->publish($owner, ConfigKey::HomeCuration, 'Featured Builds für den November ausgewählt.', $draft->revision));
        }

        // No announcement is live at $now, nor in the weeks after it (the app reads the wall clock): the approved pictures of HOME-01 show
        // none, and the stage fixture HOME-01-announcement-* is the only banner the visual matrix ever photographs (Phase 3 verify run 1).
        if (! ConfigVersion::query()->where('key', ConfigKey::Announcements->value)->exists()) {
            $ended = [
                'title' => ['de' => 'Neu: QR-Sticker bestellen', 'en' => 'New: order QR stickers'],
                'body' => ['de' => 'Dein Build bekommt einen eigenen Sticker. Wer ihn scannt, landet direkt auf deiner Seite.', 'en' => 'Your build gets its own sticker. Whoever scans it lands right on your page.'],
                'cta' => ['label' => ['de' => 'Mehr erfahren', 'en' => 'Learn more'], 'url' => '/settings/help'],
                'audience' => 'with_vehicles',
                'starts_at' => $now->subDays(24)->startOfDay()->toIso8601String(), 'ends_at' => $now->subDays(3)->startOfDay()->toIso8601String(),
                'dismissible' => true, 'severity' => 'info',
            ];
            // A maintenance Sunday about four months ahead, on the banner from the Thursday before.
            $sunday = $now->addWeeks(16)->next(CarbonInterface::SUNDAY)->startOfDay();
            $scheduled = [
                'title' => ['de' => 'Wartung am Sonntag, '.$sunday->settings(['locale' => 'de'])->translatedFormat('j. F'), 'en' => 'Maintenance on Sunday, '.$sunday->settings(['locale' => 'en'])->translatedFormat('j F')],
                'body' => ['de' => 'Zwischen 6 und 7 Uhr ist die App kurz nicht erreichbar.', 'en' => 'Between 6 and 7 am the app is briefly unavailable.'],
                'cta' => null, 'audience' => 'all',
                'starts_at' => $sunday->subDays(3)->toIso8601String(), 'ends_at' => $sunday->addDay()->toIso8601String(),
                'dismissible' => false, 'severity' => 'warning',
            ];
            $draft = SeedClock::at($at(21), fn () => app(SaveConfigDraft::class)->handle($owner, ConfigKey::Announcements, ['items' => [$ended, $scheduled]], null));
            $published = SeedClock::at($at(21, 9), fn () => $versions->publish($owner, ConfigKey::Announcements, 'Hinweis zu den QR-Stickern und zur Wartung.', $draft->revision));

            // The content editor's draft on top: a third banner for new members (a draft, so it is not live either).
            SeedClock::at($at(27, 40), fn () => app(SaveConfigDraft::class)->handle($editor, ConfigKey::Announcements, ['items' => [...$published->payload['items'], [
                'title' => ['de' => 'Willkommen im Club', 'en' => null],
                'body' => ['de' => 'Leg deine Garage an und zeig deinen ersten Build.', 'en' => null],
                'cta' => ['label' => ['de' => 'Zur Garage', 'en' => null], 'url' => '/garage'],
                'audience' => 'new', 'starts_at' => null, 'ends_at' => null, 'dismissible' => true, 'severity' => 'info',
            ]]], null));
        }

        if (! LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->where('locale', 'de')->whereNull('published_at')->exists()) {
            $draft = self::privacyDraft();
            SeedClock::at($at(44, 20), fn () => app(SaveLegalDraft::class)->handle($editor, LegalDocumentKey::Privacy, 'de', $draft));
        }

        if (! MessageTemplate::query()->where('key', 'mail.report_received')->exists()) {
            SeedClock::at($at(45, 5), fn () => app(SaveMessageTemplate::class)->handle($editor, 'mail.report_received', 'de', ['heading' => 'Danke, deine Meldung ist bei uns']));
        }

        $this->brand($owner, $editor, $versions, $at);

        // A frozen copy of docs/RELEASES.md up to 0.2.0 Build 4: every new build in the real file would change ADM-38 after the next seed
        // (DQ-702). A host's own builds come in through `speedclub:releases-sync` (DEPLOY.md), which keeps these rows (idempotent).
        SeedClock::at($at(50), fn () => app(SyncReleases::class)->handle($owner, database_path('data/demo-releases.md')));
    }

    /** The sentence of §5 QR-Codes the ADM-31 demo draft is after. */
    private const PRIVACY_DRAFT_ANCHOR = 'Die IP-Adresse verarbeiten wir beim Aufruf nur kurz, um Missbrauch zu begrenzen.';

    /** What the ADM-31 demo draft adds to it: true of qr_scan_daily, which holds a code, a day and a count. */
    public const PRIVACY_DRAFT_SENTENCE = 'Gerät, Browser und Ort eines Scans speichern wir nicht.';

    /** The changes summary of the ADM-31 demo draft (DQ-P5-116: "Sticker" since the M5 rename). */
    public const PRIVACY_DRAFT_SUMMARY = 'Sticker-Scans: Gerät, Browser und Ort eines Scans speichern wir nicht.';

    /** $body with the demo sentence after its anchor, or null when $body has no anchor paragraph. */
    public static function withDemoSentence(string $body): ?string
    {
        return str_contains($body, self::PRIVACY_DRAFT_ANCHOR)
            ? str_replace(self::PRIVACY_DRAFT_ANCHOR, self::PRIVACY_DRAFT_ANCHOR.' '.self::PRIVACY_DRAFT_SENTENCE, $body)
            : null;
    }

    /** $body without the demo sentence, or null when $body does not carry it. */
    public static function withoutDemoSentence(string $body): ?string
    {
        $needle = self::PRIVACY_DRAFT_ANCHOR.' '.self::PRIVACY_DRAFT_SENTENCE;

        return str_contains($body, $needle) ? str_replace($needle, self::PRIVACY_DRAFT_ANCHOR, $body) : null;
    }

    /**
     * The ADM-31 demo draft of the German Datenschutzerklärung (re-consent on): the current text of database/data/legal/privacy.de.md
     * with one sentence more in §5 QR-Codes, as the next version after the newest one of the document. Built on the data file, never on
     * an older stored text, so publishing it on a local or staging host cannot bring an earlier draft back (M4.18).
     *
     * @return array{version: string, body_md: string, requires_reconsent: bool, summary: string}
     */
    public static function privacyDraft(): array
    {
        $body = self::withDemoSentence(LegalDocumentSeeder::body(LegalDocumentKey::Privacy, 'de'));

        if ($body === null) {
            throw new RuntimeException('The ADM-31 demo draft needs the QR-Codes paragraph of privacy.de.md; update BrandContentDemoSeeder.');
        }

        $versions = LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->where('locale', 'de')->pluck('version')->all();
        $numbers = array_map(intval(...), array_filter($versions, ctype_digit(...)));

        return [
            'version' => (string) (max([1, ...$numbers]) + 1),
            'body_md' => $body,
            'requires_reconsent' => true,
            'summary' => self::PRIVACY_DRAFT_SUMMARY,
        ];
    }

    /**
     * ADM-28 / ADM-35 demo (DQ-612, DQ-626): two hero photos from design/seed-photos (a dark one that passes the contrast check at its
     * focal point, a bright one the draft would refuse) and a default OG image, uploaded through BrandAssets like the page does;
     * branding v2 sets the OG image (so ADM-35 has a version against the one before it), and the content editor's draft puts the
     * passing photo into "Willkommen (App)". The live heroes stay the bundled ones, so the app's screens do not change.
     */
    /**
     * @param  Closure(int, int=): CarbonImmutable  $at
     */
    private function brand(Staff $owner, Staff $editor, ConfigVersions $versions, Closure $at): void
    {
        // Photos only where the demo seeds photos at all (DEMO_PHOTO_LIMIT, 0 in the seeder tests that stay off the real disks).
        if (config()->integer('speedclub.demo.photo_limit', 0) === 0 || BrandAsset::query()->where('kind', BrandAssetKind::Hero)->exists()) {
            return;
        }

        $files = app(BrandAssets::class);
        $photo = fn (string $name, BrandAssetKind $kind, Staff $by, CarbonImmutable $moment): BrandAsset => SeedClock::at($moment, fn (): BrandAsset => $files->store(
            new UploadedFile(base_path('../design/seed-photos/'.$name), $name, 'image/jpeg', null, true),
            $kind,
            $by,
        ));

        $photo('bmw-e92-01.jpg', BrandAssetKind::Hero, $editor, $at(23, 10));
        $passing = $photo('mercedes-w204-01.jpg', BrandAssetKind::Hero, $editor, $at(23, 14));
        $og = $photo('porsche-718-01.jpg', BrandAssetKind::Og, $owner, $at(22, 30));

        $schema = app(BrandingSchema::class);
        $initial = $schema->initial();
        $live = $versions->live(ConfigKey::Branding)->payload ?? [];
        $base = [
            ...$initial,
            ...$live,
            'logos' => [...$initial['logos'], ...(is_array($live['logos'] ?? null) ? $live['logos'] : [])],
            'heroes' => [...$initial['heroes'], ...(is_array($live['heroes'] ?? null) ? $live['heroes'] : [])],
        ];

        if ($versions->draft(ConfigKey::Branding) === null) {
            $draft = SeedClock::at($at(22, 35), fn () => app(SaveConfigDraft::class)->handle($owner, ConfigKey::Branding, [...$base, 'og_default' => $og->id], null));
            $published = SeedClock::at($at(22, 41), fn () => $versions->publish($owner, ConfigKey::Branding, 'Standard-Vorschaubild für geteilte Links hochgeladen.', $draft->revision));

            SeedClock::at($at(46, 15), fn () => app(SaveConfigDraft::class)->handle($editor, ConfigKey::Branding, [
                ...$base,
                ...$published->payload,
                'heroes' => [...$base['heroes'], 'welcome' => ['asset_id' => $passing->id, 'focal_x' => 0.62, 'focal_y' => 0.55]],
            ], null));
        }
    }
}
