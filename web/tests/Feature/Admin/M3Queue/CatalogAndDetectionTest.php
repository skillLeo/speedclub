<?php

use App\Actions\Admin\Catalog\RecordCatalogExport;
use App\Actions\Admin\Media\HideMedia;
use App\Actions\Admin\Moderation\DecideCaseAsStaff;
use App\Actions\Me\UpdateProfile;
use App\Enums\CatalogImportKind;
use App\Enums\DecisionAction;
use App\Enums\KeywordList;
use App\Http\Controllers\Admin\Moderation\CaseListQuery;
use App\Models\AuditEvent;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\User;
use App\Services\Catalog\FieldData;
use App\Services\Moderation\OwnInitiativeCases;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * Catalogue and detection items of the M3.3 review: the CSV Action needs lists.export (SF-1), ADM-15's "has data" in one query (SF-8,
 * N-6), the ADM-20 "automatisiert" filter by automated || ai_detected (SF-9), and ADR-243 regression tests on the statement of reasons
 * (SF-4: automated detection true only for keyword rules and a staff case on a photo the triage flagged).
 */
beforeEach(fn () => Queue::fake());

describe('catalogue CSV (lists.export)', function () {
    it('refuses a role with catalog.view but no lists.export, on the route and in the Action', function () {
        $viewer = m3qStaffWith('catalog.view');
        actingAsStaff($viewer);

        expect($this->get('/admin/catalog/export/vehicles.csv')->status())->toBe(403)
            ->and(fn () => app(RecordCatalogExport::class)->handle($viewer, CatalogImportKind::Vehicles))->toThrow(AuthorizationException::class)
            ->and(AuditEvent::query()->where('action', 'catalog.exported')->count())->toBe(0);
    });

    it('records the export for a role with both atoms, and an empty template with catalog.view alone', function () {
        app(RecordCatalogExport::class)->handle(m3qStaffWith('catalog.view', 'lists.export'), CatalogImportKind::Brands);
        app(RecordCatalogExport::class)->handle(m3qStaffWith('catalog.view'), CatalogImportKind::Brands, template: true);

        expect(AuditEvent::query()->where('action', 'catalog.exported')->count())->toBe(2);
    });

    it('refuses an export atom without catalog.view', function () {
        expect(fn () => app(RecordCatalogExport::class)->handle(m3qStaffWith('lists.export'), CatalogImportKind::Vehicles))->toThrow(AuthorizationException::class);
    });
});

describe('ADM-15 field data', function () {
    beforeEach(function () {
        $this->category = ModCategory::factory()->create();
        foreach (['bore', 'stroke', 'note'] as $index => $key) {
            ModCategoryField::factory()->create(['category_id' => $this->category->id, 'key' => $key, 'sort' => $index + 1]);
        }
        Modification::factory()->create(['category_id' => $this->category->id, 'fields' => ['bore' => 86, 'stroke' => 86]]);
        Modification::factory()->create(['category_id' => $this->category->id, 'fields' => ['bore' => 82.5, 'note' => null]]);
        Modification::factory()->create(['category_id' => $this->category->id, 'fields' => ['stroke' => 92]])->delete();
        Modification::factory()->create(['fields' => ['bore' => 90]]);
    });

    it('counts every field in one query, soft-deleted mods included, a stored null as no data', function () {
        DB::enableQueryLog();
        $counts = FieldData::counts((int) $this->category->id, ['bore', 'stroke', 'note', 'Bad-Key\'']);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        expect($counts)->toBe(['bore' => 2, 'stroke' => 2, 'note' => 0])
            ->and($queries)->toHaveCount(1)
            ->and(FieldData::count(ModCategoryField::query()->where('key', 'stroke')->sole()))->toBe(2);
    });

    it('shows the counts on the category page with one aggregate over the modifications', function () {
        adm32SignedIn('content_editor');
        DB::enableQueryLog();
        $page = $this->get("/admin/catalog/mod-categories/{$this->category->id}")->assertOk();
        $scans = collect(DB::getQueryLog())->filter(fn (array $query): bool => str_contains($query['query'], 'JSON_TYPE'))->count();
        DB::disableQueryLog();

        $page->assertInertia(fn (AssertableInertia $p) => $p->where('fields.0.data', 2)->where('fields.1.data', 2)->where('fields.2.data', 0));
        expect($scans)->toBe(1);
    });
});

describe('ADR-243: automated detection in the statement of reasons', function () {
    it('stays false for a member-reported case whatever its triage score', function () {
        $case = adm34VehicleCase();
        ModerationCase::query()->whereKey($case->id)->update(['ai_score' => 0.95, 'ai_summary' => 'Wahrscheinlich Spam.', 'ai_scored_at' => now()]);

        $decision = app(DecideCaseAsStaff::class)->handle(m31Staff('moderator'), $case->fresh(), DecisionAction::RemoveContent, null, null, m32Statement(), m32Reason());

        expect($decision->statement_of_reasons['automated_detection'])->toBeFalse()
            ->and($decision->automatedDetection())->toBeFalse()
            ->and($decision->automatedDecision())->toBeFalse();
    });

    it('is true when staff hide a photo the triage flagged (ai_detected), false for a calm photo', function (float $score, bool $automated) {
        $vehicle = modVehicle(User::factory()->create());
        $photo = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id, 'ai_score' => $score, 'ai_summary' => 'Fremdes Kennzeichen.', 'ai_scored_at' => now()]);

        $decision = app(HideMedia::class)->handle(m31Staff('moderator'), $photo, m32Statement(), m32Reason());

        expect($decision->statement_of_reasons['automated_detection'])->toBe($automated)
            ->and(ModerationCase::query()->findOrFail($decision->case_id)->ai_detected)->toBe($automated)
            ->and($decision->automatedDecision())->toBeFalse();
    })->with(['flagged 0.9' => [0.9, true], 'calm 0.3' => [0.3, false]]);

    it('is true for a case a keyword rule filed', function () {
        adm34Rule('Rabattcode', KeywordList::Flag);
        $member = User::factory()->create();
        app(UpdateProfile::class)->handle($member, ['bio' => 'Rabattcode hier']);
        $case = ModerationCase::query()->where('target_id', $member->id)->sole();

        $decision = app(DecideCaseAsStaff::class)->handle(m31Staff('moderator'), $case, DecisionAction::RemoveContent, null, null, m32Statement(), m32Reason());

        expect($decision->statement_of_reasons['automated_detection'])->toBeTrue();
    });

    it('finds keyword and triage-flagged cases under "automatisiert", but not a reported case with a high score', function () {
        $staff = m31Staff('moderator');
        adm34Rule('Rabattcode', KeywordList::Flag);
        $member = User::factory()->create();
        app(UpdateProfile::class)->handle($member, ['bio' => 'Rabattcode hier']);
        $keyword = ModerationCase::query()->where('target_id', $member->id)->sole();

        $vehicle = modVehicle(User::factory()->create());
        $photo = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id, 'ai_score' => 0.9, 'ai_scored_at' => now()]);
        $flagged = app(OwnInitiativeCases::class)->forTarget($photo, $staff);

        $reported = adm34VehicleCase();
        ModerationCase::query()->whereKey($reported->id)->update(['ai_score' => 0.95, 'ai_scored_at' => now()]);

        $ids = CaseListQuery::build(Request::create('/admin/moderation/reports', 'GET', ['filter' => ['source' => 'automated']]), $staff, 'open', now()->toImmutable())
            ->get()->pluck('id')->all();

        expect($flagged->fresh()->ai_detected)->toBeTrue()
            ->and($ids)->toContain($keyword->id)->toContain($flagged->id)->not->toContain($reported->id);
    });
});

it('never marked a stored decision automated from a score alone', function () {
    // The lead's check after MF-1: no decision on a case without keyword or triage detection says automated_detection.
    $case = adm34VehicleCase();
    ModerationCase::query()->whereKey($case->id)->update(['ai_score' => 0.99, 'ai_scored_at' => now()]);
    app(DecideCaseAsStaff::class)->handle(m31Staff('moderator'), $case->fresh(), DecisionAction::RemoveContent, null, null, m32Statement(), m32Reason());

    $wrong = Decision::query()->whereHas('case', fn ($q) => $q->where('automated', false)->where('ai_detected', false))
        ->get()->filter(fn (Decision $decision): bool => $decision->automatedDetection());

    expect($wrong)->toHaveCount(0);
});
