<?php

use App\Http\Controllers\Admin\Content\Support\FilterLabels;
use App\Models\Make;
use App\Models\VehicleModel;
use Database\Seeders\ModCategorySeeder;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../M32/Helpers.php';

/**
 * DQ-P5-102 (Phase 5 gate): ADM-29's filter collections read "Marke: Nissan · Baujahr bis 2002", not Discover's address. The page gets
 * the names behind the slugs and option values its collections use, in the staff member's language.
 */
it('names the make, model, enum and option values the collections use, and nothing else', function () {
    $this->seed(ModCategorySeeder::class);
    $nissan = Make::factory()->create(['name' => 'Nissan', 'slug' => 'nissan']);
    VehicleModel::factory()->create(['make_id' => $nissan->id, 'name' => 'Skyline GT-R', 'slug' => 'skyline-gt-r']);
    Make::factory()->create(['name' => 'BMW', 'slug' => 'bmw']);

    $labels = app(FilterLabels::class)->for([
        ['filters' => ['make' => 'nissan', 'model' => 'skyline-gt-r', 'year_max' => 2002]],
        ['filters' => ['power_min' => 400, 'drivetrain' => ['all']]],
        ['filters' => ['suspension_type' => ['coilover'], 'mod_category' => ['suspension'], 'make' => 'unbekannt']],
    ]);

    expect($labels)->toBe([
        'make' => ['nissan' => 'Nissan'],
        'model' => ['skyline-gt-r' => 'Skyline GT-R'],
        'drivetrain' => ['all' => 'Allrad'],
        'mod_category' => ['suspension' => 'Fahrwerk'],
        'suspension_type' => ['coilover' => 'Gewindefahrwerk'],
    ]);

    app()->setLocale('en');
    expect(app(FilterLabels::class)->for([['filters' => ['drivetrain' => ['all'], 'suspension_type' => ['coilover']]]]))
        ->toBe(['drivetrain' => ['all' => 'All-wheel drive'], 'suspension_type' => ['coilover' => 'Coilovers']]);
});

it('hands ADM-29 the labels of its collections', function () {
    adm32SignedIn('content_editor');

    $this->get('/admin/content/home')->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('Content/Home')->has('filterLabels'));
});
