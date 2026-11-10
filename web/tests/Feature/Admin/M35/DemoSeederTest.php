<?php

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Models\LegalDocument;
use App\Models\MessageTemplate;
use App\Models\User;
use App\Services\AppConfig\AppConfig;
use App\Services\Config\ConfigVersions;
use Carbon\CarbonImmutable;
use Database\Seeders\BrandContentDemoSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/Helpers.php';

/** The M3.5 demo content (BrandContentDemoSeeder): through the Actions, idempotent, and drafts by the content editor. */
it('seeds the curation, announcements with a draft, a re-consent legal draft and a template, once', function () {
    // The brand demo uploads photos (DQ-612): never onto the real disks.
    Storage::fake(config()->string('speedclub.brand.public_disk'));
    Storage::fake(config()->string('speedclub.brand.private_disk'));
    m31Staff('owner');
    $editor = m31Staff('content_editor', attributes: ['email' => 'content-editor@speedclub.test']);
    m35Vehicle();
    m35Vehicle();
    m35Vehicle();

    $this->seed(BrandContentDemoSeeder::class);
    $this->seed(BrandContentDemoSeeder::class);

    expect(ConfigVersion::query()->where('key', 'home_curation')->where('status', ConfigVersionStatus::Published)->count())->toBe(1)
        ->and(ConfigVersion::query()->where('key', 'announcements')->where('status', ConfigVersionStatus::Published)->sole()->payload['items'])->toHaveCount(2)
        ->and(ConfigVersion::query()->where('key', 'announcements')->where('status', ConfigVersionStatus::Draft)->sole()->created_by)->toBe($editor->id)
        ->and(LegalDocument::query()->where('key', 'privacy')->whereNull('published_at')->sole()->requires_reconsent)->toBeTrue()
        ->and(MessageTemplate::query()->count())->toBe(1);
});

/** The live announcements of the app for both locales at the given moment (AppConfig reads the wall clock). */
function m35LiveAnnouncements(CarbonImmutable $at): array
{
    Carbon::setTestNow($at);
    CarbonImmutable::setTestNow($at);
    app(AppConfig::class)->flush();

    return [...app(AppConfig::class)->forLocale('de')['announcements'], ...app(AppConfig::class)->forLocale('en')['announcements']];
}

/**
 * Phase 3 verify run 1: no seeded announcement is live for the demo members at DemoSeeder::NOW, nor in the weeks after it (the approved
 * HOME-01 pictures show none; the stage fixture is the only banner), while ADM-30/34/35 still show an ended, a scheduled and a draft.
 */
it('seeds an ended and a scheduled announcement and the editor\'s draft, none of them live at the demo time', function () {
    m31Staff('owner');
    $editor = m31Staff('content_editor', attributes: ['email' => 'content-editor@speedclub.test']);
    m35Vehicle();
    m35Vehicle();
    m35Vehicle();
    $now = CarbonImmutable::parse(DemoSeeder::NOW);

    app(BrandContentDemoSeeder::class)->run($now);
    app(BrandContentDemoSeeder::class)->run($now);

    $versions = app(ConfigVersions::class);
    $items = $versions->live(ConfigKey::Announcements)?->payload['items'] ?? [];
    expect($items)->toHaveCount(2)
        ->and(CarbonImmutable::parse($items[0]['ends_at'])->lessThanOrEqualTo($now))->toBeTrue()
        ->and(CarbonImmutable::parse($items[1]['starts_at'])->greaterThan($now->addWeeks(12)))->toBeTrue()
        ->and($items[1]['title']['de'])->toBe('Wartung am Sonntag, 21. Februar')
        ->and($versions->draft(ConfigKey::Announcements)?->created_by)->toBe($editor->id)
        ->and($versions->draft(ConfigKey::Announcements)?->payload['items'])->toHaveCount(3)
        ->and(m35LiveAnnouncements($now))->toBe([])
        ->and(m35LiveAnnouncements($now->addWeeks(8)))->toBe([]);
});

it('leaves no announcement live for the demo members after the full demo seed', function () {
    config(['speedclub.demo.member_password' => 'demo-member-password', 'speedclub.demo.photo_limit' => 0]);
    m31Staff('owner');
    m31Staff('content_editor', attributes: ['email' => 'content-editor@speedclub.test']);

    $this->seed(DemoSeeder::class);

    expect(ConfigVersion::query()->where('key', 'announcements')->where('status', ConfigVersionStatus::Published)->sole()->payload['items'])->toHaveCount(2)
        ->and(m35LiveAnnouncements(CarbonImmutable::parse(DemoSeeder::NOW)))->toBe([]);

    $this->actingAs(User::query()->where('username', 'lukas.sc')->sole())
        ->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.announcements', []);
});
