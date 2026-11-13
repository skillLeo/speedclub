<?php

use App\Enums\HighlightItemType;
use App\Models\BuildUpdate;
use App\Models\FeatureFlag;
use App\Models\Modification;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Models\VehicleHighlight;
use App\Services\AppConfig\AppConfig;
use App\Services\Qr\QrCodes;
use Database\Seeders\FeatureFlagSeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Home/HomeTestHelpers.php';

/**
 * M4.9 API gaps: costs are never public (ruling), the pinned highlights rail on the public vehicle, the owner's updates_count, 30 days of
 * QR scans, the sticker shop flag and link, the featured quote and model covers on DISC-03.
 */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'finn.jdm']);
    $this->vehicle = homeBuild($this->owner, attributes: ['description' => 'Mein Wochenendauto. Noch lange nicht fertig.']);
});

describe('costs are never public', function () {
    it('shows a mod cost to its owner only, whatever cost_public says', function () {
        $mod = modIn($this->vehicle, 'suspension', [], ['title' => 'KW V3', 'cost_cents' => 123_450, 'cost_public' => true]);

        Sanctum::actingAs($this->owner);
        $own = collect($this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk()->json('data'))->firstWhere('id', $mod->id);
        expect($own['cost']['cents'])->toBe(123_450)->and($own['cost_public'])->toBeFalse();

        Sanctum::actingAs(User::factory()->create());
        $other = collect($this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk()->json('data'))->firstWhere('id', $mod->id);
        expect($other['cost'])->toBeNull();

        $this->app['auth']->forgetGuards();
        $public = (string) $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->getContent();
        $page = (string) $this->get("/v/{$this->vehicle->slug}")->getContent();
        expect($public)->not->toContain('123450')->and($page)->not->toContain('1.234,50')->not->toContain('123450');
    });

    it('ignores a cost_public an older app still sends', function () {
        $mod = modIn($this->vehicle, 'suspension', [], ['title' => 'KW V3', 'cost_cents' => 5000]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$mod->id}", ['cost_public' => true, 'cost_cents' => 6000])->assertOk()->assertJsonPath('data.cost_public', false);
        expect(Modification::query()->find($mod->id)?->getAttribute('cost_public'))->toBeFalse()
            ->and(Modification::query()->find($mod->id)?->getAttribute('cost_cents'))->toBe(6000);
    });
});

it('puts the owner\'s pinned highlights on the public vehicle, without what the reader may not see', function () {
    $shown = BuildUpdate::factory()->post()->create(['vehicle_id' => $this->vehicle->id]);
    $hidden = BuildUpdate::factory()->post()->create(['vehicle_id' => $this->vehicle->id, 'hidden' => true]);
    VehicleHighlight::factory()->create(['vehicle_id' => $this->vehicle->id, 'item_type' => HighlightItemType::BuildUpdate, 'item_id' => $shown->id, 'position' => 0]);
    VehicleHighlight::factory()->create(['vehicle_id' => $this->vehicle->id, 'item_type' => HighlightItemType::BuildUpdate, 'item_id' => $hidden->id, 'position' => 1]);

    $rail = $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->json('data.highlights_rail');

    expect($rail)->toHaveCount(1)
        ->and(json_encode($rail))->toContain($shown->id)->not->toContain($hidden->id);
});

it('tells the owner, and only the owner, how many Verlauf entries a build has', function () {
    BuildUpdate::factory()->count(3)->create(['vehicle_id' => $this->vehicle->id]);
    BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'hidden' => true]);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->assertJsonPath('data.updates_count', 4);
    expect(collect($this->getJson('/api/v1/me/vehicles')->assertOk()->json('data'))->firstWhere('id', $this->vehicle->id)['updates_count'])->toBe(4);

    Sanctum::actingAs(User::factory()->create());
    expect(collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->firstWhere('id', $this->vehicle->id)['updates_count'])->toBeNull();
});

it('counts QR scans over 30 days', function () {
    FeatureFlag::query()->updateOrCreate(['key' => 'sig.qr_stats'], ['enabled' => true, 'description' => 'x']);
    request()->attributes->remove('speedclub.flags');
    $qr = app(QrCodes::class)->ensureActive($this->vehicle);
    $today = now(config()->string('speedclub.display_timezone'));
    QrScanDaily::factory()->create(['qr_code_id' => $qr->id, 'day' => $today->copy()->subDays(20)->toDateString(), 'count' => 5]);
    QrScanDaily::factory()->create(['qr_code_id' => $qr->id, 'day' => $today->copy()->subDays(3)->toDateString(), 'count' => 2]);
    QrScanDaily::factory()->create(['qr_code_id' => $qr->id, 'day' => $today->copy()->subDays(40)->toDateString(), 'count' => 7]);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/qr/stats")->assertOk()
        ->assertJsonCount(30, 'data.days')
        ->assertJsonPath('data.total_30_days', 7)
        ->assertJsonPath('data.total_14_days', 2)
        ->assertJsonPath('data.total', 14);
});

it('has the sticker shop off with no link by default, and the link once set', function () {
    $this->seed(FeatureFlagSeeder::class);
    app(AppConfig::class)->flush();

    $this->getJson('/api/v1/app-config')->assertOk()
        ->assertJsonPath('data.flags.sticker_shop', false)
        ->assertJsonPath('data.links.sticker_shop', null);

    config(['speedclub.app_config.links.sticker_shop' => 'https://shop.example.org/sticker']);
    app(AppConfig::class)->flush();
    $this->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.links.sticker_shop', 'https://shop.example.org/sticker');
});

it('gives the featured build the owner\'s quote and DISC-03 models their cover', function () {
    config(['speedclub.home.featured_slugs' => [$this->vehicle->slug]]);

    $this->getJson('/api/v1/home/featured')->assertOk()
        ->assertJsonPath('data.0.vehicle.id', $this->vehicle->id)
        ->assertJsonPath('data.0.quote', 'Mein Wochenendauto.');

    $make = $this->vehicle->make;
    $this->getJson("/api/v1/discover/makes/{$make?->slug}")->assertOk()
        ->assertJsonPath('data.models.0.cover.id', fn (?string $id): bool => is_string($id));
});
