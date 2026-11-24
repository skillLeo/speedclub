<?php

use App\Models\AiSpecSuggestion;
use App\Models\AuditEvent;
use App\Models\Generation;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../M33/Helpers.php';

/**
 * M5.9 (m5.9-contract §8, lead D-5): ADM-14 model page, "KI-Herstellerangaben löschen" of a generation. DELETE
 * /admin/catalog/entries/generation/{generation}/ai-specs needs catalog.manage (Owner, Admin, Content editor) and a recent password like
 * every catalogue delete, takes a reason of 10–1,000 characters and audits `catalog.ai_specs_deleted`; with nothing stored it answers
 * OK without an audit row. The page tells per generation whether a suggestion is stored and since when.
 */
beforeEach(function () {
    Queue::fake();
    seedModSchema();
});

function adm59AiSpecsUri(int $generation): string
{
    return "/admin/catalog/entries/generation/{$generation}/ai-specs";
}

it('deletes the stored suggestion with catalog.manage, audits it with the reason and leaves other generations alone', function () {
    [, , $generation] = adm33Tree();
    AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);
    $other = AiSpecSuggestion::factory()->create();
    $staff = adm32SignedIn('content_editor');

    $this->from("/admin/catalog/models/{$generation->model_id}")
        ->delete(adm59AiSpecsUri($generation->id), ['reason' => '  Leistungsangabe des Roadster war falsch.  '])
        ->assertStatus(303)->assertRedirect("/admin/catalog/models/{$generation->model_id}")
        ->assertSessionHas('success', 'catalog.flash.ai_specs_deleted');

    expect(AiSpecSuggestion::query()->pluck('id')->all())->toBe([$other->id]);
    $event = AuditEvent::query()->where('action', 'catalog.ai_specs_deleted')->sole();
    expect($event->getAttribute('reason'))->toBe('Leistungsangabe des Roadster war falsch.')
        ->and($event->getAttribute('actor_id'))->toBe((string) $staff->id);
});

it('answers OK with 0 deleted and writes no audit row when nothing is stored', function () {
    [, , $generation] = adm33Tree();
    adm32SignedIn('admin');

    $this->delete(adm59AiSpecsUri($generation->id), ['reason' => 'Noch einmal geprüft, nichts mehr da.'])
        ->assertStatus(303)->assertSessionHasNoErrors()->assertSessionHas('success', 'catalog.flash.ai_specs_none');

    expect(AuditEvent::query()->where('action', 'catalog.ai_specs_deleted')->exists())->toBeFalse();
});

it('takes an optional reason of at most 1,000 characters (ADR-540)', function (array $data) {
    [, , $generation] = adm33Tree();
    AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);
    adm32SignedIn('content_editor');

    $this->delete(adm59AiSpecsUri($generation->id), $data)->assertSessionHasErrors('reason');

    expect(AiSpecSuggestion::query()->where('generation_id', $generation->id)->exists())->toBeTrue()
        ->and(AuditEvent::query()->where('action', 'catalog.ai_specs_deleted')->exists())->toBeFalse();
})->with([
    'too long' => [['reason' => str_repeat('x', 1001)]],
]);

it('guards the route by catalog.manage: guest to the sign-in, the other roles 403, and nothing deleted', function () {
    [, , $generation] = adm33Tree();
    AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);

    adm32WriteMatrix('DELETE', adm59AiSpecsUri($generation->id), ADM33_CATALOG, ['reason' => adm32Reason()]);
});

it('refuses every role without catalog.manage with 403 and keeps the suggestion', function (string $role) {
    [, , $generation] = adm33Tree();
    AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);
    adm32SignedIn($role);

    $this->delete(adm59AiSpecsUri($generation->id), ['reason' => adm32Reason()])->assertForbidden();

    expect(AiSpecSuggestion::query()->where('generation_id', $generation->id)->exists())->toBeTrue();
})->with(['moderator', 'support', 'analyst']);

it('redirects a guest to the sign-in and deletes nothing', function () {
    [, , $generation] = adm33Tree();
    AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);

    $this->delete(adm59AiSpecsUri($generation->id), ['reason' => adm32Reason()])->assertRedirect('/admin/login');

    expect(AiSpecSuggestion::query()->where('generation_id', $generation->id)->exists())->toBeTrue();
});

it('asks for the password first (ADR-215) and deletes nothing', function () {
    [, , $generation] = adm33Tree();
    AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);
    seedStaffRoles();
    actingAsStaff(staffWithRole('content_editor'));

    $this->delete(adm59AiSpecsUri($generation->id), ['reason' => adm32Reason()])->assertStatus(303)->assertSessionHas('confirm_password', true);

    expect(AiSpecSuggestion::query()->where('generation_id', $generation->id)->exists())->toBeTrue();
});

it('answers 404 for an unknown generation', function () {
    adm32SignedIn('content_editor');

    $this->delete(adm59AiSpecsUri(999999), ['reason' => adm32Reason()])->assertNotFound();
});

it('tells the model page per generation whether a suggestion is stored and since when', function () {
    [, $model, $with] = adm33Tree();
    $without = Generation::factory()->create(['model_id' => $model->id, 'name' => 'Coupé', 'slug' => 'coupe', 'year_from' => 2015]);
    AiSpecSuggestion::factory()->create(['generation_id' => $with->id, 'created_at' => Carbon::parse('2026-11-14 09:30:00', 'UTC')]);
    AiSpecSuggestion::factory()->create(['generation_id' => null, 'model_id' => $model->id, 'model_year' => 2016]);
    adm32SignedIn('content_editor');

    $this->get("/admin/catalog/models/{$model->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Catalog/Model')
        ->where('generations', fn ($rows) => collect($rows)->firstWhere('id', $with->id)['ai_specs'] === ['exists' => true, 'created_at' => '2026-11-14T09:30:00+00:00']
            && collect($rows)->firstWhere('id', $without->id)['ai_specs'] === ['exists' => false, 'created_at' => null]));
});

it('loads the flag of every generation in the same query as the generations (no N+1)', function () {
    [, $model] = adm33Tree();
    foreach (range(1, 4) as $i) {
        $generation = Generation::factory()->create(['model_id' => $model->id, 'name' => "Gen {$i}", 'slug' => "gen-{$i}"]);
        AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);
    }
    adm32SignedIn('content_editor');

    DB::enableQueryLog();
    $response = $this->get("/admin/catalog/models/{$model->id}");
    $queries = collect(DB::getQueryLog())->pluck('query')->filter(fn (string $sql): bool => str_contains($sql, 'ai_spec_suggestions'));

    $response->assertOk();
    expect($queries)->toHaveCount(1);
});
