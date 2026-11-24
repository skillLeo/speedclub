<?php

use App\Enums\ModStatus;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\User;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * DQ-P5-029 (design QA P5 r1): WEB-01 says what VEH-01's one scroll says (ADR-505/521): the same section names in the same order
 * (Überblick · Daten · Mods · Pläne · Verlauf · Galerie), Mods counts only the built parts, and the planned ones are in Pläne.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    $this->owner = User::factory()->create(['username' => 'jonas.e46']);
    $this->vehicle = publishedVehicle($this->owner);
    foreach (range(1, 3) as $i) {
        Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
    }
    $category = ModCategory::factory()->create();
    Modification::factory()->create(['vehicle_id' => $this->vehicle->id, 'category_id' => $category->id, 'title' => 'KW V3 Gewindefahrwerk']);
    Modification::factory()->create(['vehicle_id' => $this->vehicle->id, 'category_id' => $category->id, 'title' => 'H&R Stabilisatoren']);
    Modification::factory()->create(['vehicle_id' => $this->vehicle->id, 'category_id' => $category->id, 'title' => 'Tomei Expreme Ti', 'status' => ModStatus::Planned, 'installed_on' => null]);
    $this->url = '/v/'.$this->vehicle->canonicalSlug();
});

it('names and orders the sections as the app does, with Pläne and Galerie', function () {
    $html = $this->get($this->url)->assertOk()->getContent();

    preg_match_all('/data-testid="WEB-01\.nav\.([a-z]+)">([^<]+)</', (string) $html, $nav);
    expect($nav[1])->toBe(['overview', 'specs', 'mods', 'plans', 'history', 'gallery'])
        ->and(array_map('trim', $nav[2]))->toBe(['Überblick', 'Daten', 'Mods', 'Pläne', 'Verlauf', 'Galerie']);

    $en = (string) $this->withHeader('Accept-Language', 'en')->get($this->url.'?lang=en')->getContent();
    preg_match_all('/data-testid="WEB-01\.nav\.[a-z]+">([^<]+)</', $en, $navEn);
    expect(array_map('trim', $navEn[1]))->toBe(['Overview', 'Specs', 'Mods', 'Plans', 'History', 'Gallery']);
});

it('counts only built mods and lists the planned one under Pläne', function () {
    $html = (string) $this->get($this->url)->assertOk()->getContent();
    $mods = (string) str($html)->betweenFirst('data-testid="WEB-01.mods"', '</section>');
    $plans = (string) str($html)->betweenFirst('data-testid="WEB-01.plans"', '</section>');

    expect($mods)->toContain('KW V3 Gewindefahrwerk')->toContain('H&amp;R Stabilisatoren')->not->toContain('Tomei')
        ->and(preg_match('/<span class="text-callout tabular-nums text-ink-3">(\d+)<\/span>/', $mods, $count))->toBe(1)
        ->and($count[1])->toBe('2')
        ->and($plans)->toContain('Tomei Expreme Ti')->not->toContain('KW V3');
});

it('leaves Pläne out of a build without plans and Galerie out of one without photos', function () {
    Modification::query()->where('status', ModStatus::Planned->value)->delete();
    $html = (string) $this->get($this->url)->assertOk()->getContent();

    expect($html)->not->toContain('data-testid="WEB-01.plans"')->not->toContain('WEB-01.nav.plans')
        ->toContain('data-testid="WEB-01.gallery"');
});
