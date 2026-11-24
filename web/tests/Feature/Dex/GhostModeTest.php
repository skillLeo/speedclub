<?php

use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\PublicPages\LandingPage;
use App\Services\PublicPages\SitemapWriter;
use Laravel\Sanctum\Sanctum;
use Tests\Support\SourceScanner;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b ghost mode (m5.9b contract §5): a ghost car is hidden from search, Discover, Home, other members' views of the profile garage,
 * the sitemap and the landing page; its page is noindex; its link, its sticker and an in-person spot still reach it. Every surface is
 * checked next to a normal car of the same owner and make, so "absent" never passes because a list is simply empty. The last test
 * scans app/ for list queries on public vehicles, so a new read path cannot forget the rule.
 */
beforeEach(function () {
    $this->owner = dexMember(['username' => 'geist.fahrer', 'display_name' => 'Geist']);
    [$this->plain, $this->plainCode] = dexCar($this->owner);
    [$this->ghost, $this->ghostCode] = dexCar($this->owner, ['make_id' => $this->plain->make_id, 'model_id' => $this->plain->model_id, 'generation_id' => $this->plain->generation_id, 'ghost_mode' => true]);
    $this->ghost->refresh();
});

/**
 * @return list<string>
 */
function ghostIds(string $url, string $path = 'data'): array
{
    return array_values(array_map(fn (array $row): string => (string) ($row['id'] ?? $row['vehicle']['id'] ?? ''), test()->getJson($url)->assertOk()->json($path) ?? []));
}

it('keeps the ghost car out of the search projection', function () {
    expect(VehicleSearch::query()->find($this->ghost->id)?->is_public)->toBeFalse()
        ->and(VehicleSearch::query()->find($this->plain->id)?->is_public)->toBeTrue();
});

it('hides it from Home', function () {
    expect(ghostIds('/api/v1/home/new-builds'))->toBe([$this->plain->id]);
});

it('hides it from search and from the garage line of member search', function () {
    $make = (string) $this->plain->make?->name;

    expect(ghostIds('/api/v1/search/vehicles?q='.urlencode($make)))->toBe([$this->plain->id]);

    $hit = collect(test()->getJson('/api/v1/search/users?q=geist')->assertOk()->json('data'))->firstWhere('username', 'geist.fahrer');
    expect($hit['garage']['vehicles'] ?? null)->toBe(1);
});

it('hides it from Discover make pages', function () {
    $slug = (string) $this->plain->make?->slug;

    expect($this->getJson('/api/v1/discover/makes/'.$slug)->assertOk()->json('data.make.vehicle_count'))->toBe(1);
});

it('hides it from the profile garage of others, not from the owner', function () {
    expect(ghostIds('/api/v1/public/users/geist.fahrer/vehicles'))->toBe([$this->plain->id])
        ->and($this->getJson('/api/v1/public/users/geist.fahrer')->assertOk()->json('data.stats.vehicles'))->toBe(1);

    Sanctum::actingAs(dexMember());
    expect(ghostIds('/api/v1/public/users/geist.fahrer/vehicles'))->toBe([$this->plain->id]);

    Sanctum::actingAs($this->owner);
    expect(ghostIds('/api/v1/public/users/geist.fahrer/vehicles'))->toEqualCanonicalizing([$this->plain->id, $this->ghost->id]);
});

it('hides it from the public profile page, the sitemap and the landing page', function () {
    $this->get('/u/geist.fahrer')->assertOk()->assertSee($this->plain->canonicalSlug())->assertDontSee($this->ghost->canonicalSlug());

    $xml = app(SitemapWriter::class)->render();
    expect($xml)->toContain($this->plain->canonicalSlug())->and($xml)->not->toContain($this->ghost->canonicalSlug());

    config(['speedclub.public_pages.featured_slug' => $this->ghost->slug]);
    // R4-1.5: the landing page features no builds any more; its sticker code leads to one, never a ghost car.
    expect(app(LandingPage::class)->lead()?->id)->not->toBe($this->ghost->id);
});

it('keeps its page reachable by link and sticker, as noindex', function () {
    $this->get('/v/'.$this->ghost->canonicalSlug())->assertOk()->assertSee('noindex', false);
    $this->get('/v/'.$this->plain->canonicalSlug())->assertOk()->assertDontSee('name="robots" content="noindex', false);
    $this->get('/c/'.$this->ghostCode)->assertRedirect();
    $this->getJson('/api/v1/public/vehicles/'.$this->ghost->slug)->assertOk();
});

it('reveals it to an in-person spot with the Ghost frame', function () {
    dexSpot(dexMember(), $this->ghostCode)->assertCreated()->assertJsonPath('data.vehicle.rarity', 'ghost')->assertJsonPath('data.vehicle.ghost', true);
});

describe('the owner switches', function () {
    it('are the owner\'s to read and write on the vehicle', function () {
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$this->plain->id}")->assertOk()
            ->assertJsonPath('data.ghost_mode', false)
            ->assertJsonPath('data.spotting_paused', false)
            ->assertJsonPath('data.hide_spot_cities', false);

        $this->patchJson("/api/v1/vehicles/{$this->plain->id}", ['ghost_mode' => true, 'spotting_paused' => true, 'hide_spot_cities' => true])->assertOk()
            ->assertJsonPath('data.ghost_mode', true)
            ->assertJsonPath('data.spotting_paused', true)
            ->assertJsonPath('data.hide_spot_cities', true);

        expect(VehicleSearch::query()->find($this->plain->id)?->is_public)->toBeFalse();
        app('auth')->forgetGuards();
        expect(ghostIds('/api/v1/home/new-builds'))->toBe([]);

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$this->plain->id}", ['ghost_mode' => false])->assertOk()->assertJsonPath('data.ghost_mode', false);
        expect(VehicleSearch::query()->find($this->plain->id)?->is_public)->toBeTrue();
    });

    it('are never shown to others, and only the owner may change them', function () {
        $other = dexMember();
        Sanctum::actingAs($other);

        $this->getJson("/api/v1/vehicles/{$this->ghost->id}")->assertOk()
            ->assertJsonPath('data.ghost_mode', null)
            ->assertJsonPath('data.spotting_paused', null)
            ->assertJsonPath('data.hide_spot_cities', null);
        $this->patchJson("/api/v1/vehicles/{$this->ghost->id}", ['ghost_mode' => false])->assertForbidden();

        app('auth')->forgetGuards();
        $this->patchJson("/api/v1/vehicles/{$this->ghost->id}", ['ghost_mode' => false])->assertUnauthorized();

        dexBlock($this->owner, $other);
        Sanctum::actingAs($other);
        $this->patchJson("/api/v1/vehicles/{$this->ghost->id}", ['ghost_mode' => false])->assertForbidden();

        expect(Vehicle::query()->findOrFail($this->ghost->id)->ghost_mode)->toBeTrue();
    });

    it('take booleans only', function () {
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->plain->id}", ['ghost_mode' => 'yes'])->assertUnprocessable()->assertJsonValidationErrors(['ghost_mode']);
        $this->patchJson("/api/v1/vehicles/{$this->plain->id}", ['spotting_paused' => null])->assertUnprocessable()->assertJsonValidationErrors(['spotting_paused']);
    });
});

it('applies the rule on every list of public vehicles (read-path coverage)', function () {
    $root = dirname(__DIR__, 3);
    // A query that narrows vehicles to the public ones lists them somewhere. Each such file applies GhostMode, or is named here with the
    // reason it does not list builds to others.
    $exempt = [
        'app/Http/Controllers/Admin/Content/PreviewController.php' => 'staff preview of one build',
        'app/Http/Controllers/Admin/Vehicles/VehicleListQuery.php' => 'staff list (ADM)',
        'app/Http/Controllers/Api/V1/Social/SaveController.php' => 'the member\'s own saved builds',
        'app/Services/BuildScore/BuildScoreNightly.php' => 'M5.9c ranks: leaves ghost cars out itself (v.ghost_mode), lists none',
        'app/Services/BuildScore/BuildScores.php' => 'R4 live rank group count (rankedCars): leaves ghost cars out itself (v.ghost_mode), lists none',
        'app/Services/Dex/DexNightly.php' => 'counts cars per generation for the nightly rarity, lists none',
        'app/Services/Dex/DexQuery.php' => 'the member\'s own Dex: found ghost cars stay',
        'app/Services/Dex/RarityRules.php' => 'counts cars per generation, lists none',
        'app/Services/Discover/SimilarMembers.php' => 'the viewer\'s own vehicles',
        'app/Services/Notifications/NotificationFeed.php' => 'the build a notification is about',
        'app/Services/Wrapped/Cards/PercentileCard.php' => 'M5.9e: counts the member\'s Bundesland group for a percentile, leaves ghost cars out itself (v.ghost_mode), lists none',
    ];
    $missing = [];

    foreach (SourceScanner::phpFiles(["$root/app"]) as $file) {
        $source = (string) file_get_contents($file);
        $relative = str_replace($root.'/', '', $file);

        $lists = preg_match("/where(In)?\\('(v\\.|vehicles\\.)?visibility', (Visibility::Public|\\[Visibility::Public)/", $source) === 1;

        if ($lists && ! str_contains($source, 'GhostMode') && ! isset($exempt[$relative])) {
            $missing[] = $relative;
        }
    }

    expect($missing)->toBe([]);
});
