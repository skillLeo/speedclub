<?php

use App\Enums\ApprovalStatus;
use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\FeatureFlag;
use App\Models\LegalDocument;
use App\Models\SorTemplate;
use App\Services\AppConfig\AppConfig;
use Database\Seeders\BrandContentDemoSeeder;
use Database\Seeders\FeatureFlagSeeder;
use Database\Seeders\LegalDocumentSeeder;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Admin/M35/Helpers.php';

/**
 * M4.18 data fixes for hosts seeded earlier: the statement-of-reasons templates cite the sections of the Phase 4 AGB and
 * Community-Richtlinien (2026_12_10_100000), and the ADM-31 demo privacy draft is the Phase 4 text, never an older one
 * (BrandContentDemoSeeder::privacyDraft, 2026_12_10_100100). The flag `android_widget` (09 §8.14/§8.18, on · on · off) reaches seeded hosts
 * (2026_12_10_100300) and fresh ones (FeatureFlagSeeder).
 */
function m418Migration(string $name): object
{
    return require database_path("migrations/$name.php");
}

/** @return array<string, string> "N" => heading of each numbered `## N. …` section of a data file */
function m418Sections(LegalDocumentKey $key, string $locale): array
{
    preg_match_all('/^## (\d+)\. (.+)$/m', LegalDocumentSeeder::body($key, $locale), $matches, PREG_SET_ORDER);

    return array_column(array_map(fn (array $match): array => [$match[1], $match[2]], $matches), 1, 0);
}

describe('statement-of-reasons templates', function () {
    it('cites the section that holds the rule, in German and English', function (string $key, string $document, string $section, string $de, string $en) {
        $templates = SorTemplate::query()->where('key', $key)->get()->keyBy('locale');
        $legal = LegalDocumentKey::from($document);

        expect($templates)->toHaveCount(2)
            ->and($templates['de']->ground_document->value)->toBe($document)
            ->and($templates['de']->ground_section)->toBe($section)
            ->and($templates['en']->ground_section)->toBe($section)
            ->and(m418Sections($legal, 'de')[$section] ?? null)->toBe($de)
            ->and(m418Sections($legal, 'en')[$section] ?? null)->toBe($en);
    })->with([
        'spam' => ['spam', 'community', '6', 'Kein Spam', 'No spam'],
        'harassment' => ['harassment', 'community', '2', 'Respekt', 'Respect'],
        'impersonation' => ['impersonation', 'terms', '3', 'Konto', 'Account'],
        'nudity' => ['nudity', 'community', '4', 'Deine Inhalte', 'Your content'],
    ]);

    it('names a section only where it points into the AGB or the Community-Richtlinien', function () {
        foreach (SorTemplate::query()->get() as $template) {
            $document = $template->ground_document->value;

            if ($document === 'law') {
                expect($template->ground_section)->toBeNull();

                continue;
            }

            expect(array_keys(m418Sections(LegalDocumentKey::from($document), $template->locale)))->toContain((int) $template->ground_section);
        }
    });

    it('corrects a seeded row and leaves one staff changed alone; a second run changes nothing', function () {
        $migration = m418Migration('2026_12_10_100000_correct_sor_template_sections');
        DB::table('sor_templates')->whereIn('key', ['spam', 'nudity'])->where('locale', 'de')->update(['ground_section' => DB::raw("CASE `key` WHEN 'spam' THEN '4' ELSE '3' END")]);
        DB::table('sor_templates')->where('key', 'nudity')->where('locale', 'de')->update(['label' => 'Nacktheit (von Hand)']);

        expect($migration->correct($migration::SEEDED))->toBe(1)
            ->and(SorTemplate::query()->where('key', 'spam')->where('locale', 'de')->value('ground_section'))->toBe('6')
            ->and(SorTemplate::query()->where('key', 'nudity')->where('locale', 'de')->value('ground_section'))->toBe('3')
            ->and($migration->correct($migration::SEEDED))->toBe(0);

        $audit = AuditEvent::query()->where('action', 'moderation.template_saved')->latest('id')->firstOrFail();
        expect($audit->actor_type)->toBe(AuditActorType::System)
            ->and($audit->before['ground_section'])->toBe('4')
            ->and($audit->after['ground_section'])->toBe('6');
    });
});

describe('ADM-31 demo privacy draft', function () {
    beforeEach(function () {
        $this->seed(LegalDocumentSeeder::class);
    });

    it('builds the demo draft on the current data file, with one true sentence more and the next version', function () {
        $draft = BrandContentDemoSeeder::privacyDraft();
        $current = LegalDocumentSeeder::body(LegalDocumentKey::Privacy, 'de');

        expect($draft['version'])->toBe('2')
            ->and($draft['requires_reconsent'])->toBeTrue()
            ->and($draft['body_md'])->toContain(BrandContentDemoSeeder::PRIVACY_DRAFT_SENTENCE)
            ->and(str_replace(' '.BrandContentDemoSeeder::PRIVACY_DRAFT_SENTENCE, '', $draft['body_md']))->toBe($current)
            ->and(substr_count($draft['body_md'], '## '))->toBe(substr_count($current, '## '));
    });

    it('seeds that draft on a fresh demo', function () {
        m31Staff('owner');
        m31Staff('content_editor', attributes: ['email' => 'content-editor@speedclub.test']);

        $this->seed(BrandContentDemoSeeder::class);

        $draft = LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->where('locale', 'de')->whereNull('published_at')->sole();
        expect($draft->body_md)->toBe(BrandContentDemoSeeder::privacyDraft()['body_md'])->and($draft->version)->toBe('2');
    });

    it('turns a stale demo draft into the Phase 4 one past the published version, once', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '3', 'body_md' => LegalDocumentSeeder::body(LegalDocumentKey::Privacy, 'de')]);
        $stale = "# Datenschutzerklärung\n\nAlter Text.\n\n\n## QR-Scans\n\nScans deines QR-Stickers speichern wir nur noch als Tageszahlen, ohne Gerät oder Ort.";
        $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2', 'body_md' => $stale, 'requires_reconsent' => true, 'summary' => 'alt']);
        $migration = m418Migration('2026_12_10_100100_refresh_demo_privacy_draft');

        expect($migration->refresh([hash('sha256', $stale)]))->toBeTrue();

        $draft->refresh();
        expect($draft->body_md)->toBe(BrandContentDemoSeeder::privacyDraft()['body_md'])
            ->and($draft->body_md)->not->toContain('Alter Text')
            ->and($draft->version)->toBe('4')
            ->and($draft->published_at)->toBeNull()
            ->and(AuditEvent::query()->where('action', 'legal.draft_saved')->latest('id')->value('actor_type'))->toBe(AuditActorType::System)
            ->and($migration->refresh([hash('sha256', $stale)]))->toBeFalse();
    });

    it('leaves a draft staff wrote alone, and one whose re-consent publish waits for approval', function () {
        $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2', 'body_md' => "# Datenschutz\n\nVon Hand.\n"]);
        $migration = m418Migration('2026_12_10_100100_refresh_demo_privacy_draft');

        expect($migration->refresh($migration::OLD_DRAFTS))->toBeFalse()
            ->and($draft->fresh()?->body_md)->toBe("# Datenschutz\n\nVon Hand.\n");

        ApprovalRequest::factory()->create([
            'action' => 'legal.publish_reconsent', 'status' => ApprovalStatus::Pending,
            'subject_type' => $draft->getMorphClass(), 'subject_id' => (string) $draft->getKey(),
        ]);
        expect($migration->refresh([hash('sha256', $draft->body_md)]))->toBeFalse();
    });

    it('lists the hash of the local demo draft seeded before M4.18, and none of the new one', function () {
        $migration = m418Migration('2026_12_10_100100_refresh_demo_privacy_draft');

        expect($migration::OLD_DRAFTS)->toContain('3812f4b89f738ffdde8208c523ad04f0131c3f7fd52abc92ad924ea1f516b506')
            ->not->toContain(hash('sha256', BrandContentDemoSeeder::privacyDraft()['body_md']));
    });
});

function m418WidgetMigration(): object
{
    return m418Migration('2026_12_10_100300_add_android_widget_flag');
}

describe('flag android_widget', function () {
    it('reaches an existing host on outside production, and the app reads it from app-config', function () {
        FeatureFlag::query()->create(['key' => 'events', 'enabled' => true, 'description' => 'x']);

        m418WidgetMigration()->up();

        expect(DB::table('feature_flags')->where('key', 'android_widget')->value('enabled'))->toBeTruthy()
            ->and(DB::table('feature_flags')->where('key', 'android_widget')->value('description'))->toContain('Mein Auto');

        app(AppConfig::class)->flush();
        $this->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.flags.android_widget', true);
    });

    it('arrives off on a production host', function () {
        FeatureFlag::query()->create(['key' => 'events', 'enabled' => false, 'description' => 'x']);
        app()->detectEnvironment(fn () => 'production');

        m418WidgetMigration()->up();

        expect(DB::table('feature_flags')->where('key', 'android_widget')->value('enabled'))->toBeFalsy();
    });

    it('never changes an admin\'s row, and runs again without a second one', function () {
        FeatureFlag::query()->create(['key' => 'android_widget', 'enabled' => false, 'description' => 'von Hand aus']);

        m418WidgetMigration()->up();
        m418WidgetMigration()->up();

        expect(DB::table('feature_flags')->where('key', 'android_widget')->count())->toBe(1)
            ->and(DB::table('feature_flags')->where('key', 'android_widget')->value('enabled'))->toBeFalsy()
            ->and(DB::table('feature_flags')->where('key', 'android_widget')->value('description'))->toBe('von Hand aus');
    });

    it('leaves an empty flag table to the seeder, which seeds it on outside production and off in production', function () {
        m418WidgetMigration()->up();
        expect(FeatureFlag::query()->count())->toBe(0);

        $this->seed(FeatureFlagSeeder::class);
        expect((bool) FeatureFlag::query()->where('key', 'android_widget')->value('enabled'))->toBeTrue();

        FeatureFlag::query()->delete();
        app()->detectEnvironment(fn () => 'production');
        // Directly: db:seed asks for confirmation in production.
        app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();
        expect((bool) FeatureFlag::query()->where('key', 'android_widget')->value('enabled'))->toBeFalse();
    });
});
