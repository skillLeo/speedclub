<?php

use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ConfigKey;
use App\Models\DiscoverCollection;
use App\Models\Vehicle;
use App\Services\Config\ConfigVersions;
use App\Services\Home\HomeCuration;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * ADM-29: featured builds with a date range (at most 8 live), collections synced to DISC-01, speedclub.home.featured_slugs as the
 * fallback while nothing is live (ADR-190).
 */
beforeEach(function () {
    $this->editor = m31Staff('content_editor');
    $this->publish = function (array $payload): void {
        app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::HomeCuration, $payload, null);
        app(PublishConfigVersion::class)->handle($this->editor, ConfigKey::HomeCuration, m35Reason(), 1);
    };
});

it('feeds Home with the live featured builds in their order and falls back to the config list', function () {
    [$a, $b, $c] = [m35Vehicle(), m35Vehicle(), m35Vehicle()];
    $fallback = m35Vehicle();
    config(['speedclub.home.featured_slugs' => [$fallback->slug]]);

    expect(app(HomeCuration::class)->featuredSlugs())->toBe([$fallback->slug]);

    ($this->publish)(['featured' => [
        ['vehicle_id' => $b->id],
        ['vehicle_id' => $a->id, 'starts_at' => now()->subDay()->toIso8601String(), 'ends_at' => now()->addDay()->toIso8601String()],
        ['vehicle_id' => $c->id, 'starts_at' => now()->addWeek()->toIso8601String()],
    ], 'collections' => []]);

    expect(app(HomeCuration::class)->featuredSlugs())->toBe([$b->slug, $a->slug]);
    $this->travel(3)->days();
    expect(app(HomeCuration::class)->featuredSlugs())->toBe([$b->slug]);
    $this->travel(7)->days();
    expect(app(HomeCuration::class)->featuredSlugs())->toBe([$b->slug, $c->slug]);
});

it('refuses more than 8 builds live at once, but not 10 in turn', function () {
    $vehicles = collect(range(1, 10))->map(fn () => m35Vehicle());

    $all = $vehicles->map(fn (Vehicle $vehicle) => ['vehicle_id' => $vehicle->id])->all();
    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::HomeCuration, ['featured' => $all, 'collections' => []], null))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('featured'));

    $inTurn = $vehicles->values()->map(fn (Vehicle $vehicle, int $i) => [
        'vehicle_id' => $vehicle->id,
        'starts_at' => now()->addDays($i)->toIso8601String(),
        'ends_at' => now()->addDays($i + 1)->toIso8601String(),
    ])->all();
    expect(app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::HomeCuration, ['featured' => $inTurn, 'collections' => []], null)->payload['featured'])->toHaveCount(10);
});

it('refuses a build that is not public and a range that ends before it starts', function () {
    $private = Vehicle::factory()->private()->create();
    $public = m35Vehicle();

    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::HomeCuration, ['featured' => [['vehicle_id' => $private->id]], 'collections' => []], null))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('featured.0.vehicle_id'));
    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::HomeCuration, ['featured' => [[
        'vehicle_id' => $public->id, 'starts_at' => now()->addDay()->toIso8601String(), 'ends_at' => now()->toIso8601String(),
    ]], 'collections' => []], null))->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('featured.0.ends_at'));
});

it('syncs the collections DISC-01 reads: order, titles, deactivation; hand-picked sets stay inactive', function () {
    DiscoverCollection::factory()->create(['key' => 'old-one', 'active' => true]);
    $vehicle = m35Vehicle();

    ($this->publish)(['featured' => [], 'collections' => [
        ['key' => 'jdm-legends', 'title' => ['de' => 'JDM-Legenden', 'en' => 'JDM legends'], 'mode' => 'filter', 'filters' => ['q' => 'supra'], 'sort' => 'newest', 'active' => true],
        ['key' => 'editors-picks', 'title' => ['de' => 'Unsere Auswahl'], 'mode' => 'vehicles', 'vehicle_ids' => [$vehicle->id], 'active' => true],
    ]]);

    $jdm = DiscoverCollection::query()->where('key', 'jdm-legends')->firstOrFail();
    expect($jdm->getTranslation('title', 'en'))->toBe('JDM legends')->and($jdm->position)->toBe(0)->and($jdm->active)->toBeTrue()
        ->and($jdm->filters)->toBe(['q' => 'supra'])
        ->and(DiscoverCollection::query()->where('key', 'editors-picks')->value('active'))->toBeFalse()
        ->and(DiscoverCollection::query()->where('key', 'old-one')->value('active'))->toBeFalse();
});

it('starts the first draft from the config list and the existing collections', function () {
    $vehicle = m35Vehicle();
    config(['speedclub.home.featured_slugs' => [$vehicle->slug]]);
    DiscoverCollection::factory()->create(['key' => 'seeded', 'title' => ['de' => 'Gesät', 'en' => 'Seeded']]);

    $payload = app(ConfigVersions::class)->startingPayload(ConfigKey::HomeCuration);

    expect($payload['featured'])->toBe([['vehicle_id' => $vehicle->id, 'starts_at' => null, 'ends_at' => null]])
        ->and(collect($payload['collections'])->pluck('key')->all())->toContain('seeded');
});
