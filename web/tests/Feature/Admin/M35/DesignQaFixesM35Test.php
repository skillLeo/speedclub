<?php

use App\Enums\BrandAssetKind;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\BrandAsset;
use App\Models\ConfigVersion;
use App\Models\Release;
use App\Services\Brand\HeroContrast;
use App\Services\Config\ConfigVersions;
use App\Services\Releases\ReleaseRegister;
use Database\Seeders\BrandContentDemoSeeder;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * Fixes after the M3.5 design QA (docs/reports/design-qa/phase-3/2026-11-09-M3.5-M3.6.md), lane b.
 */
it('seeds a passing and a failing hero, an OG image, branding v2 and the editor\'s hero draft, once (DQ-612, DQ-626)', function () {
    Storage::fake(config()->string('speedclub.brand.public_disk'));
    Storage::fake(config()->string('speedclub.brand.private_disk'));
    config(['speedclub.demo.photo_limit' => 60]);
    m31Staff('owner');
    $editor = m31Staff('content_editor', attributes: ['email' => 'content-editor@speedclub.test']);

    $this->seed(BrandContentDemoSeeder::class);
    $this->seed(BrandContentDemoSeeder::class);

    $heroes = BrandAsset::query()->where('kind', BrandAssetKind::Hero)->orderBy('created_at')->orderBy('id')->get();
    expect($heroes)->toHaveCount(2)
        ->and(BrandAsset::query()->where('kind', BrandAssetKind::Og)->count())->toBe(1);

    $versions = app(ConfigVersions::class);
    $live = $versions->live(ConfigKey::Branding);
    $draft = $versions->draft(ConfigKey::Branding);
    expect($live?->payload['og_default'])->toBe(BrandAsset::query()->where('kind', BrandAssetKind::Og)->value('id'))
        ->and(ConfigVersion::query()->where('key', 'branding')->where('status', '!=', ConfigVersionStatus::Draft)->count())->toBeGreaterThanOrEqual(1)
        ->and($draft?->created_by)->toBe($editor->id);

    // The draft's welcome hero passes at its focal point; the other upload would be refused.
    $welcome = $draft?->payload['heroes']['welcome'];
    $contrast = app(HeroContrast::class);
    $passing = BrandAsset::query()->findOrFail($welcome['asset_id']);
    $failing = $heroes->firstWhere('id', '!=', $passing->id);
    expect($contrast->forAsset($passing, $welcome['focal_x'], $welcome['focal_y'])->toArray()['passes'])->toBeTrue()
        ->and($contrast->forAsset($failing, 0.5, 0.55)->toArray()['passes'])->toBeFalse()
        ->and($live?->payload['heroes']['welcome'] ?? null)->toBeNull();
});

it('lists every versioned key the staff member may open, with rollback only where the page drafts (ADM-35)', function () {
    adm32SignedIn('owner');

    $this->get('/admin/content/versions')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
        ->where('keys', ['branding', 'home_curation', 'announcements', 'remote_config', 'rate_limits', 'org', 'retention']));
    $this->get('/admin/content/versions?key=rate_limits')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
        ->where('configKey', 'rate_limits')->where('canRollback', false)->where('editRoute', 'admin.moderation.rules'));
    $this->get('/admin/content/versions?key=branding')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('canRollback', true));

    app('auth')->forgetGuards();
    adm32SignedIn('content_editor');
    $this->get('/admin/content/versions')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
        ->where('keys', ['branding', 'home_curation', 'announcements']));
    $this->get('/admin/content/versions?key=retention')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('configKey', 'branding'));
});

it('keeps the lead-in of a release note and shows it as one sentence with the full note rendered (DQ-614, DQ-647)', function () {
    $entries = app(ReleaseRegister::class)->parse(<<<'MD'
## 0.2.0 (Build 4) - lan - 2026-11-09 05:48
- SHA-256: 932AE22E788049E1FB6094763CAF76DEAC86F3BA428C0DFFAB390EE0087D346D
- Changes since Build 3: the last M2.8 QA fixes. App: the `#email=` re-render loop. Test harness only otherwise
- Known issues (Low): none
MD);
    expect($entries[0]['notes'])->toStartWith('Changes since Build 3: the last M2.8 QA fixes.')
        ->and(ReleaseRegister::summary($entries[0]['notes']))->toBe('Changes since Build 3: the last M2.8 QA fixes.')
        ->and(ReleaseRegister::summary(null))->toBeNull();

    Release::query()->create(['version_name' => '0.2.0', 'version_code' => 4, 'platform' => 'android', 'channel' => 'lan', 'notes' => $entries[0]['notes'], 'released_at' => now(), 'source' => 'sync']);
    adm32SignedIn('admin');

    $this->get('/admin/config/releases')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
        ->where('rows.data.0.notes_summary', 'Changes since Build 3: the last M2.8 QA fixes.')
        ->where('rows.data.0.notes_html', fn (string $html) => str_contains($html, '<code>#email=</code>') && ! str_contains($html, '`')));
});

it('refuses a rollback without the key\'s publish atom before asking for the password (code review SF-3)', function () {
    adm35StalePassword('content_editor');

    $this->post('/admin/content/versions/remote_config/1/rollback', ['reason' => adm32Reason()])->assertForbidden();
    // With the atom the same stale session is asked for its password first.
    $this->post('/admin/content/versions/branding/1/rollback', ['reason' => adm32Reason()])->assertSessionHas('confirm_password');
});

it('never lets a preview answer be stored: no ETag, no-store and Vary on the token (code review SF-2)', function () {
    $editor = adm32SignedIn('content_editor');
    adm35Draft($editor, ConfigKey::Branding, m35Branding(['accent_set' => 'racingBlue']));
    $token = $this->get('/admin/content/preview')->assertOk()->viewData('page')['props']['preview']['token'];
    auth('staff')->logout();

    $api = $this->withHeader('X-Preview-Token', $token)->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.branding.accent_set', 'racingBlue');
    expect($api->headers->get('Cache-Control'))->toContain('no-store')
        ->and($api->headers->has('ETag'))->toBeFalse()
        ->and($api->headers->get('Vary'))->toContain('X-Preview-Token');

    $page = $this->get('/app/?preview='.$token);
    expect($page->headers->get('Cache-Control'))->toContain('no-store')
        ->and($page->headers->has('ETag'))->toBeFalse()
        ->and($page->headers->get('Vary'))->toContain('X-Preview-Token');

    // Without a token nothing changes: the live answer keeps its ETag and revalidation.
    $live = $this->flushHeaders()->getJson('/api/v1/app-config')->assertOk();
    expect($live->headers->has('ETag'))->toBeTrue()->and($live->headers->get('Cache-Control'))->toContain('no-cache');
});

it('keeps the "Entwurf gespeichert" flash when the background contrast check lands in between (A3)', function () {
    m35FakeDisks();
    $staff = adm32SignedIn('content_editor');
    $hero = m35Asset();

    session()->flash('success', 'brand.flash.saved');
    session()->ageFlashData();

    $this->getJson("/admin/brand/assets/{$hero->id}/contrast?focal_x=0.5&focal_y=0.5")->assertOk()->assertJsonStructure(['passes', 'logo_ratio']);
    $this->get('/admin/brand')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('flash.success', 'brand.flash.saved'));
    expect($staff->id)->toBeInt();
});
