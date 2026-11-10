<?php

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\BrandAssetKind;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Mail\TemplateTestMail;
use App\Models\BrandAsset;
use App\Models\ConfigVersion;
use App\Models\LegalDocument;
use App\Models\Release;
use App\Services\AppConfig\AppConfig;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\Handlers\PublishLegalWithReconsent;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use App\Services\Content\MessageTemplates;
use App\Services\Content\TemplateRegistry;
use App\Services\PublicPages\OgImages;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * The server items M3.5 carried into the admin round (lane b): MF-3 of the M3.4-batch review (a re-consent approval pins the text it
 * approves), SF-7 (the OG default is read from the cached app-config), SF-8 (two first drafts of a key at once: 409 draft_taken, never a
 * deadlock 500), the logo sizes in app-config, the preview token through the admin, uploads and the hero contrast refusal through
 * the admin, the RELEASES.md sync and the template test mail to the staff member's own address.
 */
beforeEach(function () {
    Mail::fake();
    m35FakeDisks();
});

describe('MF-3: a re-consent approval pins version, text and summary', function () {
    function adm35ReconsentDraft(): LegalDocument
    {
        return app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Privacy, 'de', [
            'version' => '3',
            'body_md' => "# Datenschutz\n\nNeu: Wir speichern QR-Scans nur noch als Tageszahlen.",
            'requires_reconsent' => true,
            'summary' => 'QR-Scans werden nur noch gezählt.',
        ]);
    }

    it('pins the version, the text hash and the summary in the approval payload', function () {
        $draft = adm35ReconsentDraft();
        $outcome = app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft));

        expect($outcome->approval?->payload)->toMatchArray([
            'document_id' => $draft->id,
            'version' => '3',
            'body_sha256' => hash('sha256', $draft->body_md),
            'summary' => 'QR-Scans werden nur noch gezählt.',
        ]);
    });

    it('refuses to edit the draft while its approval waits (legal_pending_approval), also through the admin', function () {
        $draft = adm35ReconsentDraft();
        app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft));

        expect(fn () => app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Privacy, 'de', ['version' => '3', 'body_md' => "# Datenschutz\n\nGanz anderer Text, nach der Anfrage."]))
            ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('legal_pending_approval'));

        adm32SignedIn('content_editor');
        $this->post('/admin/content/legal/privacy/de/draft', ['version' => '3', 'body_md' => "# Datenschutz\n\nGanz anderer Text, nach der Anfrage."])
            ->assertSessionHasErrors('refused');
        expect($draft->refresh()->body_md)->toContain('Tageszahlen');
    });

    it('cannot publish an edited draft with the old approval: the approval fails and nothing goes live', function (Closure $edit) {
        $draft = adm35ReconsentDraft();
        $request = app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft))->approval;
        // Any other path that changes the row (a direct edit, a restore): the approval no longer matches it.
        $edit($draft);

        $decided = app(Approvals::class)->approve($request, m31Staff('owner'));

        expect($decided->status)->toBe(ApprovalStatus::Failed)->and($draft->refresh()->published_at)->toBeNull();
    })->with([
        'text' => [fn (LegalDocument $d) => $d->forceFill(['body_md' => "# Datenschutz\n\nUntergeschobener Text ohne Prüfung."])->save()],
        'version' => [fn (LegalDocument $d) => $d->forceFill(['version' => '4'])->save()],
        'summary' => [fn (LegalDocument $d) => $d->forceFill(['summary' => 'Etwas ganz anderes.'])->save()],
    ]);

    it('re-checks the pins in execute() under the row lock, even after validate() passed', function () {
        $draft = adm35ReconsentDraft();
        $request = app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft))->approval;
        expect(PublishLegalDocument::matchesPins($draft, $request->payload))->toBeTrue();

        // Code review SF-4: the text changes after validate() passed, while the handler's execute() loads the document (the window
        // between the two); only the pin check in execute() under the row lock can still stop it.
        $edited = false;
        LegalDocument::retrieved(function (LegalDocument $document) use (&$edited): void {
            $inExecute = collect(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS))->contains(fn (array $frame): bool => ($frame['class'] ?? null) === PublishLegalWithReconsent::class && $frame['function'] === 'execute');
            if (! $edited && $inExecute) {
                $edited = true;
                DB::table('legal_documents')->where('id', $document->id)->update(['body_md' => $document->body_md.' Nachtrag nach der Prüfung.']);
            }
        });

        $decided = app(Approvals::class)->approve($request, m31Staff('owner'));

        expect($edited)->toBeTrue()
            ->and($decided->status)->toBe(ApprovalStatus::Failed)
            ->and($draft->refresh()->published_at)->toBeNull();
    });

    it('decides direct or four-eyes from the locked row, never from a stale model (code review SF-1)', function () {
        $draft = app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Privacy, 'de', [
            'version' => '3',
            'body_md' => "# Datenschutz\n\nEine kleine Korrektur ohne neue Zustimmung.",
        ]);
        $stale = LegalDocument::query()->findOrFail($draft->id);
        // Saved with re-consent between the page's load and the publish.
        DB::table('legal_documents')->where('id', $draft->id)->update(['requires_reconsent' => true, 'summary' => 'Neu: Tageszahlen.']);

        expect(fn () => app(PublishLegalDocument::class)->handle(m31Staff('admin'), $stale, adm32Reason(), PublishLegalDocument::revision($stale)))
            ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('approval_required'));
        expect($draft->refresh()->published_at)->toBeNull();
    });

    it('answers 409 to a save or publish of a draft that moved since the page loaded it (code review SF-1)', function () {
        $draft = app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Terms, 'de', ['version' => '7', 'body_md' => "# AGB\n\nDie Fassung, die das Team geöffnet hat."]);
        $seen = PublishLegalDocument::revision($draft);
        app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Terms, 'de', ['version' => '7', 'body_md' => "# AGB\n\nInzwischen von jemand anderem geändert."]);

        adm32SignedIn('admin');
        $this->postJson('/admin/content/legal/terms/de/draft', ['version' => '7', 'body_md' => "# AGB\n\nMeine Fassung, auf dem alten Stand.", 'revision' => $seen])->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => $seen])->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        expect($draft->refresh()->published_at)->toBeNull()->and($draft->body_md)->toContain('Inzwischen');

        $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($draft)])->assertRedirect();
        expect($draft->refresh()->published_at)->not->toBeNull();
    });

    it('publishes the unchanged draft on approval', function () {
        $draft = adm35ReconsentDraft();
        $request = app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft))->approval;

        expect(app(Approvals::class)->approve($request, m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed)
            ->and($draft->refresh()->published_at)->not->toBeNull();
    });
});

describe('SF-7: the OG default comes from the cached app-config', function () {
    it('answers the configured default, then the published og_default, without a query once cached', function () {
        $staff = m31Staff('content_editor');
        expect(app(OgImages::class)->defaultUrl())->toBe(url(config()->string('speedclub.public_pages.og_default')));

        $og = m35Asset(BrandAssetKind::Og, 'generic-exterior-01.jpg');
        adm35Publish($staff, ConfigKey::Branding, m35Branding(['og_default' => $og->id]));
        $first = app(OgImages::class)->defaultUrl();

        DB::enableQueryLog();
        DB::flushQueryLog();
        $again = app(OgImages::class)->defaultUrl();
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        expect($first)->toContain('/storage/')->and($first)->toEndWith('.jpg')->and($again)->toBe($first)
            ->and(array_filter($queries, fn (array $q) => str_contains($q['query'], 'config_versions') || str_contains($q['query'], 'brand_assets')))->toBe([]);
    });
});

describe('SF-8: two first drafts of a key at once', function () {
    it('answers a racing first draft (the unique version taken by the other insert) with 409 draft_taken', function () {
        $first = m31Staff('content_editor');
        $second = m31Staff('content_editor');
        // The other request inserts its draft between this one's lock and insert: what the empty key cannot lock against.
        ConfigVersion::creating(function (ConfigVersion $row) use ($first): void {
            if ($row->created_by !== $first->id && ConfigVersion::query()->where('key', $row->key)->doesntExist()) {
                DB::table('config_versions')->insert(['key' => $row->key, 'version' => $row->version, 'status' => ConfigVersionStatus::Draft->value, 'revision' => 1, 'payload' => json_encode(['items' => []]), 'created_by' => $first->id, 'created_at' => now(), 'updated_at' => now()]);
            }
        });

        try {
            app(ConfigVersions::class)->saveDraft($second, ConfigKey::Announcements, ['items' => []], null);
            $this->fail('A racing first draft must be refused.');
        } catch (ConfigRefused $refused) {
            expect($refused->reason)->toBe('draft_taken')->and($refused->status())->toBe(409);
        } finally {
            ConfigVersion::flushEventListeners();
        }
    });

    it('answers a lock wait on the key held by another connection with 409 draft_taken, never a 500', function () {
        $first = m31Staff('content_editor');
        $second = m31Staff('content_editor');
        $name = DB::getDefaultConnection();
        config(["database.connections.{$name}_sf8" => config("database.connections.$name")]);
        $other = DB::connection("{$name}_sf8");
        // The staff rows of this test are uncommitted (RefreshDatabase): the other connection inserts without the foreign key check.
        $other->statement('SET SESSION foreign_key_checks = 0');
        $other->beginTransaction();

        try {
            $other->table('config_versions')->insert(['key' => 'announcements', 'version' => 1, 'status' => 'draft', 'revision' => 1, 'payload' => '{"items":[]}', 'created_by' => $first->id, 'created_at' => now(), 'updated_at' => now()]);
            DB::statement('SET SESSION innodb_lock_wait_timeout = 1');

            expect(fn () => app(ConfigVersions::class)->saveDraft($second, ConfigKey::Announcements, ['items' => []], null))
                ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('draft_taken')->and($refused->status())->toBe(409));
        } finally {
            $other->rollBack();
            $other->disconnect();
            DB::statement('SET SESSION innodb_lock_wait_timeout = 50');
        }
    });
});

describe('app-config branding.logo_sizes', function () {
    it('names the intrinsic size of every logo, the bundled wordmarks included', function () {
        $sizes = $this->getJson('/api/v1/app-config')->assertOk()->json('data.branding.logo_sizes');
        expect($sizes)->toBe([
            'wordmark_white' => ['width' => 640, 'height' => 192],
            'wordmark_black' => ['width' => 640, 'height' => 192],
            'square' => null,
            'app_mark' => null,
        ]);
    });

    it('gives a published custom wordmark its own width and height', function () {
        $logo = BrandAsset::factory()->create(['kind' => BrandAssetKind::WordmarkWhite, 'width' => 1600, 'height' => 400, 'variants' => [640 => 'brand/wordmark_white/test-640.webp']]);
        adm35Publish(m31Staff('content_editor'), ConfigKey::Branding, m35Branding(['logos' => ['wordmark_white' => $logo->id]]));
        app(AppConfig::class)->flush();

        expect($this->getJson('/api/v1/app-config')->json('data.branding.logo_sizes.wordmark_white'))->toBe(['width' => 1600, 'height' => 400])
            ->and($this->getJson('/api/v1/app-config')->json('data.branding.logos.wordmark_white'))->toEndWith('test-640.webp');
    });
});

describe('the preview token through the admin (ADM-34)', function () {
    it('issues a token bound to the visitor that shows only their own drafts, read-only, and lets the frames embed the page', function () {
        $editor = adm32SignedIn('content_editor');
        $other = staffWithRole('content_editor');
        adm35Publish($other, ConfigKey::Announcements, ['items' => []]);
        adm35Draft($editor, ConfigKey::Branding, m35Branding(['accent_set' => 'racingBlue']));

        $props = $this->get('/admin/content/preview')->assertOk()->viewData('page')['props'];
        $token = $props['preview']['token'];
        expect($props['preview']['keys'])->toBe(['branding']);

        auth('staff')->logout();
        app(AppConfig::class)->flush();
        expect($this->getJson('/api/v1/app-config')->json('data.branding.accent_set'))->not->toBe('racingBlue');
        $this->getJson('/api/v1/app-config?preview='.$token)->assertJsonPath('data.branding.accent_set', 'racingBlue')->assertHeader('X-SpeedClub-Preview', '1');

        // Another staff member's later draft never shows through this token.
        adm35Draft($other, ConfigKey::Announcements, ['items' => [['title' => ['de' => 'Nur ein Entwurf', 'en' => null], 'body' => ['de' => 'Text', 'en' => null], 'cta' => null, 'audience' => 'all', 'dismissible' => true, 'severity' => 'info']]]);
        expect($this->getJson('/api/v1/app-config?preview='.$token)->json('data.announcements'))->toBe([]);

        // Read-only (code review SF-4): a write carrying the token, signed out, is refused and changes nothing.
        $before = ConfigVersion::query()->where('key', 'branding')->orderBy('id')->get(['id', 'status', 'revision'])->toArray();
        $write = $this->withHeader('X-Preview-Token', $token)->postJson('/admin/brand/publish?preview='.$token, ['reason' => adm32Reason(), 'revision' => 1]);
        expect($write->status())->toBeIn([401, 403, 419])
            ->and(ConfigVersion::query()->where('key', 'branding')->orderBy('id')->get(['id', 'status', 'revision'])->toArray())->toBe($before)
            ->and(ConfigVersion::query()->where('key', 'branding')->where('status', ConfigVersionStatus::Published)->exists())->toBeFalse();

        // The draft preview frames: the page with a valid token may be framed by the admin's origin, never without one.
        $framed = $this->get('/app/?preview='.$token);
        expect($framed->headers->get('X-Frame-Options'))->toBe('SAMEORIGIN');
        expect($this->get('/app/')->headers->get('X-Frame-Options'))->toBe('DENY')
            ->and($this->get('/app/?preview=forged.token-value-1234567890')->headers->get('X-Frame-Options'))->toBe('DENY');
    });

    it('stops working when it expires', function () {
        adm32SignedIn('content_editor');
        $token = $this->get('/admin/content/preview')->viewData('page')['props']['preview']['token'];
        auth('staff')->logout();

        $this->travel(16)->minutes();
        expect($this->get('/app/?preview='.$token)->headers->get('X-Frame-Options'))->toBe('DENY');
        $this->getJson('/api/v1/app-config?preview='.$token)->assertHeaderMissing('X-SpeedClub-Preview');
    });
});

describe('uploads and the hero contrast through the admin', function () {
    it('uploads a hero re-encoded and without EXIF, and refuses a non-image', function () {
        adm32SignedIn('content_editor');

        $this->post('/admin/brand/assets', ['kind' => 'hero', 'file' => m35Upload(m35SeedPhoto('welcome-hero.jpg'))])->assertSessionHas('success', 'brand.flash.uploaded');
        $asset = BrandAsset::query()->where('kind', BrandAssetKind::Hero)->sole();
        expect($asset->variants)->not->toBeEmpty();

        $this->post('/admin/brand/assets', ['kind' => 'hero', 'file' => UploadedFile::fake()->createWithContent('hero.jpg', 'not an image at all')])->assertSessionHasErrors('file');
        expect(BrandAsset::query()->count())->toBe(1);
    });

    it('measures the contrast at a focal point and refuses a draft whose hero fails it', function () {
        adm32SignedIn('content_editor');
        $bright = m35Asset(BrandAssetKind::Hero, 'bmw-e92-01.jpg');

        $this->getJson("/admin/brand/assets/{$bright->id}/contrast?focal_x=0.5&focal_y=0.5")->assertOk()->assertJsonPath('passes', false)->assertJsonStructure(['logo_ratio', 'text_ratio', 'minimum']);
        $this->post('/admin/brand/draft', ['payload' => m35Branding(['heroes' => ['welcome' => ['asset_id' => $bright->id, 'focal_x' => 0.5, 'focal_y' => 0.5]]])])
            ->assertSessionHasErrors('heroes.welcome.asset_id');
        expect(ConfigVersion::query()->where('key', 'branding')->exists())->toBeFalse();
    });
});

describe('ADM-38 and ADM-33 writes', function () {
    it('syncs RELEASES.md idempotently from the admin', function () {
        $file = tempnam(sys_get_temp_dir(), 'releases');
        file_put_contents($file, "# Releases\n\n## 0.2.0 (Build 20) - production - 2026-11-01 18:42\n- APK: speedclub-0.2.0.apk\n- SHA-256: `".str_repeat('AB', 32)."`\n- Changes: Erste öffentliche Testversion.\n");
        config(['speedclub.content.releases_path' => $file]);
        adm32SignedIn('owner');

        $this->post('/admin/config/releases/sync')->assertSessionHas('success', 'config.flash.releases_synced');
        $this->post('/admin/config/releases/sync')->assertSessionHas('success', 'config.flash.releases_unchanged');
        expect(Release::query()->count())->toBe(1);
        unlink($file);
    });

    it('records a release by hand and refuses the same build twice in words', function () {
        adm32SignedIn('owner');
        $build = ['version_name' => '1.0.0', 'version_code' => 100, 'platform' => 'android', 'channel' => 'production', 'apk_sha256' => str_repeat('c', 64)];

        $this->post('/admin/config/releases', $build)->assertSessionHas('success', 'config.flash.release_recorded');
        $this->post('/admin/config/releases', $build)->assertSessionHasErrors('refused');
        expect(Release::query()->sole()->apk_sha256)->toBe(str_repeat('C', 64));
    });

    it('sends the template test only to the signed-in staff member\'s own address, with the unsaved text', function () {
        $staff = adm32SignedIn('content_editor');

        $this->post('/admin/content/templates/mail.report_received/de/test', ['fields' => ['heading' => 'Danke, deine Meldung ist bei uns']])->assertSessionHas('success', 'content.flash.template_test_sent');

        Mail::assertSent(TemplateTestMail::class, fn (TemplateTestMail $mail) => $mail->hasTo($staff->email) && count($mail->to) === 1 && ($mail->fields['heading'] ?? null) === 'Danke, deine Meldung ist bei uns');
    });

    it('fills every placeholder of every template in the preview (no raw ":name" in ADM-33)', function () {
        $templates = app(MessageTemplates::class);
        $raw = [];
        foreach (array_keys(app(TemplateRegistry::class)->all()) as $key) {
            foreach (['de', 'en'] as $locale) {
                foreach ($templates->render($key, $locale) as $field => $text) {
                    if (preg_match('/(?<![\w\/]):[a-z][a-z_]*/', $text) === 1) {
                        $raw[] = "$key.$field ($locale)";
                    }
                }
            }
        }

        expect($raw)->toBe([]);
    });

    it('refuses a fixed field and an unknown variable as field errors', function () {
        adm32SignedIn('content_editor');

        $this->put('/admin/content/templates/mail.report_outcome/de', ['fields' => ['redress' => 'Kein Einspruch möglich.']])->assertSessionHasErrors('refused');
        $this->put('/admin/content/templates/mail.report_received/de', ['fields' => ['subject' => 'Hallo :nachname']])->assertSessionHasErrors('fields.subject');
        $this->get('/admin/content/templates?template=mail.report_received')->assertInertia(fn (AssertableInertia $page) => $page->where('templates.0.customised', []));
    });
});
