<?php

use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\HelpArticle;
use App\Models\Release;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * M3.5 pages ADM-28…38 (m3.5-contract §2), lane b: the authorisation matrix of every page and JSON read by the 06 §2 role table, and the
 * props each page reads.
 */
describe('authorisation matrix of the pages', function () {
    it('guards every page by its atom', function (string $uri, string $component, array $allowed) {
        assertAdminMatrix('GET', $uri, $allowed, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component)));
    })->with([
        'ADM-28 brand' => ['/admin/brand', 'Brand/Index', ADM35_CONTENT],
        'ADM-29 home' => ['/admin/content/home', 'Content/Home', ADM35_CONTENT],
        'ADM-30 announcements' => ['/admin/content/announcements', 'Content/Announcements', ADM35_CONTENT],
        'ADM-31 legal' => ['/admin/content/legal', 'Content/Legal', ADM35_CONTENT],
        'ADM-32 help' => ['/admin/content/help', 'Content/Help', ADM35_CONTENT],
        'ADM-33 templates' => ['/admin/content/templates', 'Content/Templates', ADM35_CONTENT],
        'ADM-34 preview' => ['/admin/content/preview', 'Content/Preview', ADM35_CONTENT],
        'ADM-35 versions' => ['/admin/content/versions', 'Content/Versions', ADM35_CONTENT],
        'ADM-36 flags' => ['/admin/config/flags', 'Config/Flags', ADM35_OWNER_ADMIN],
        'ADM-37 remote' => ['/admin/config/remote', 'Config/Remote', ADM35_OWNER_ADMIN],
        'ADM-38 releases' => ['/admin/config/releases', 'Config/Releases', ADM35_OWNER_ADMIN],
    ]);

    it('guards the JSON reads', function (string $uri, array $allowed) {
        if (str_contains($uri, '{asset}')) {
            m35FakeDisks();
            $uri = str_replace('{asset}', m35Asset()->id, $uri);
        }

        assertAdminMatrix('GET', $uri, $allowed, fn (TestResponse $r) => $r->assertOk()->assertHeader('Content-Type', 'application/json'));
    })->with([
        'hero contrast' => ['/admin/brand/assets/{asset}/contrast?focal_x=0.5&focal_y=0.5', ADM35_CONTENT],
        'build picker' => ['/admin/content/home/vehicles?q=bmw', ADM35_CONTENT],
    ]);
});

describe('page props', function () {
    it('gives ADM-28 the editor, the accent sets of the palette and the themes, never a free colour', function () {
        adm32SignedIn('content_editor');

        $this->get('/admin/brand')->assertInertia(fn (AssertableInertia $page) => $page
            ->where('editor.draft', null)
            ->where('editor.can', ['edit' => true, 'publish' => true])
            ->where('accentSets', ['signalRed', 'emberOrange', 'racingBlue', 'pitGreen'])
            ->where('themes', ['carbon', 'black', 'light', 'system'])
            ->has('minimums.hero')
            ->has('editor.payload.accent_set'));
    });

    it('starts ADM-28 from every slot when the live branding predates the logo set (the first install\'s bundled paths)', function () {
        $staff = adm32SignedIn('content_editor');
        ConfigVersion::query()->create(['key' => 'branding', 'version' => 1, 'status' => ConfigVersionStatus::Published, 'revision' => 1, 'created_by' => $staff->id, 'published_at' => now(),
            'payload' => ['logo' => '/brand/logo-wide-white-640.webp', 'accent_set' => 'default', 'splash_image' => '/brand/logo-wide-on-texture.webp', 'welcome_hero' => null, 'default_theme' => 'carbon']]);

        $this->get('/admin/brand')->assertInertia(fn (AssertableInertia $page) => $page
            ->where('editor.payload.logos', ['wordmark_white' => null, 'wordmark_black' => null, 'square' => null, 'app_mark' => null])
            ->where('editor.payload.heroes', ['welcome' => null, 'landing' => null, 'splash' => null])
            ->where('editor.payload.accent_set', 'signalRed')
            ->where('editor.payload.logo', '/brand/logo-wide-white-640.webp'));
    });

    it('lists only the keys a role may open in ADM-35 and refuses a key it may not', function () {
        adm32SignedIn('content_editor');

        $this->get('/admin/content/versions')->assertInertia(fn (AssertableInertia $page) => $page
            ->where('keys', ['branding', 'home_curation', 'announcements'])->where('configKey', 'branding'));
        $this->get('/admin/content/versions?key=remote_config')->assertInertia(fn (AssertableInertia $page) => $page->where('configKey', 'branding'));
    });

    it('tells ADM-35 which set the first install\'s accent alias `default` stands for, on branding only (DQ-668)', function () {
        adm32SignedIn('content_editor');

        $this->get('/admin/content/versions?key=branding')->assertInertia(fn (AssertableInertia $page) => $page->where('accentDefault', 'signalRed'));
        $this->get('/admin/content/versions?key=home_curation')->assertInertia(fn (AssertableInertia $page) => $page->where('accentDefault', null));
    });

    it('opens the first template in ADM-33 with its fields, variables and fixed fields', function () {
        adm32SignedIn('content_editor');

        $this->get('/admin/content/templates?template=mail.report_outcome&locale=en')->assertInertia(fn (AssertableInertia $page) => $page
            ->where('selected.key', 'mail.report_outcome')->where('selected.locale', 'en')
            ->where('selected.fields', fn ($fields) => collect($fields)->firstWhere('name', 'redress')['editable'] === false
                && collect($fields)->firstWhere('name', 'subject')['editable'] === true)
            ->has('samples.vehicle'));
        $this->get('/admin/content/templates')->assertInertia(fn (AssertableInertia $page) => $page->where('selected.key', 'mail.report_received'));
    });

    it('shows ADM-36 every flag with its state per environment and whether AI is available', function () {
        FeatureFlag::factory()->create(['key' => 'ai.translate', 'enabled' => false]);
        adm32SignedIn('admin');

        $this->get('/admin/config/flags')->assertInertia(fn (AssertableInertia $page) => $page
            ->where('environment', 'local')->where('production', false)->where('aiAvailable', false)
            ->where('flags', fn ($flags) => collect($flags)->firstWhere('key', 'ai.translate')['ai'] === true));
    });

    it('pages, filters and sorts ADM-38 on the server', function () {
        Release::factory()->create(['version_name' => '0.2.0', 'version_code' => 20, 'channel' => 'production']);
        Release::factory()->create(['version_name' => '0.1.0', 'version_code' => 10, 'channel' => 'lan']);
        adm32SignedIn('owner');

        $this->get('/admin/config/releases?filter[channel]=production')->assertInertia(fn (AssertableInertia $page) => $page
            ->has('rows.data', 1)->where('rows.data.0.version_name', '0.2.0')->where('query.filter.channel', 'production'));
        $this->get('/admin/config/releases?sort=version_code')->assertInertia(fn (AssertableInertia $page) => $page->where('rows.data.0.version_name', '0.1.0'));
    });

    it('lists help articles with their state for ADM-32', function () {
        HelpArticle::factory()->create(['key' => 'qr-sticker', 'published' => false]);
        adm32SignedIn('content_editor');

        $this->get('/admin/content/help')->assertInertia(fn (AssertableInertia $page) => $page->where('articles.0.key', 'qr-sticker')->where('articles.0.published', false));
    });
});
