<?php

use App\Enums\BuildUpdateType;
use App\Models\BuildUpdate;
use App\Services\Garage\BuildUpdatePresenter;

require_once __DIR__.'/GarageTestHelpers.php';

/**
 * DQ-290: the bold title of a Verlauf entry is the category and the verb of its first change (03_DESIGN_SYSTEM §8).
 */
beforeEach(fn () => seedModSchema());

it('names the category and the verb of the first change, per language', function (BuildUpdateType $type, array $payload, string $de, string $en) {
    $update = BuildUpdate::factory()->create(['type' => $type, 'payload' => $payload, 'note' => $type === BuildUpdateType::Note ? 'Winterpause' : null]);
    $presenter = app(BuildUpdatePresenter::class);

    expect($presenter->typeLabel($update, 'de'))->toBe($de)->and($presenter->typeLabel($update, 'en'))->toBe($en);
})->with([
    'suspension changed' => [BuildUpdateType::ModChanged, ['changes' => [['kind' => 'mod_changed', 'category' => 'suspension']]], 'Fahrwerk geändert', 'Suspension changed'],
    'wheels added' => [BuildUpdateType::ModAdded, ['changes' => [['kind' => 'mod_added', 'category' => 'wheels_tires']]], 'Räder hinzugefügt', 'Wheels added'],
    'exhaust removed' => [BuildUpdateType::ModRemoved, ['changes' => [['kind' => 'mod_removed', 'category' => 'exhaust']]], 'Abgasanlage entfernt', 'Exhaust removed'],
    'specs' => [BuildUpdateType::SpecsChanged, ['changes' => [['kind' => 'specs_changed', 'field' => 'power_ps']]], 'Technik aktualisiert', 'Specs updated'],
    'photos' => [BuildUpdateType::PhotosAdded, ['changes' => [['kind' => 'photos_added', 'count' => 3]]], 'Fotos hinzugefügt', 'Photos added'],
    'note' => [BuildUpdateType::Note, [], 'Notiz', 'Note'],
    'mixed: the first change decides' => [BuildUpdateType::ModAdded, ['changes' => [['kind' => 'mod_changed', 'category' => 'brakes'], ['kind' => 'mod_added', 'category' => 'exhaust'], ['kind' => 'photos_added', 'count' => 2]]], 'Bremsen geändert', 'Brakes changed'],
    'an older row without category' => [BuildUpdateType::ModAdded, ['before' => 'Serie', 'after' => 'KW V3'], 'Modifikation hinzugefügt', 'Modification added'],
]);
