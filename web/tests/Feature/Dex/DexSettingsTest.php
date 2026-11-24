<?php

use App\Enums\Bundesland;
use App\Services\Notifications\NotificationPrefs;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b settings (m5.9b contract §1, §4, §10): "Meine Spots zeigen" (SET-07) in GET/PATCH me/settings, the spot_alert type of SET-09,
 * and users.bundesland from the SET-11 region or the profile city.
 */
it('reads and writes show_my_spots, on by default', function () {
    $member = dexMember();
    Sanctum::actingAs($member);

    $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.show_my_spots', true);
    $this->patchJson('/api/v1/me/settings', ['show_my_spots' => false])->assertOk()->assertJsonPath('data.show_my_spots', false);
    $this->patchJson('/api/v1/me/settings', ['show_my_spots' => 'no'])->assertUnprocessable()->assertJsonValidationErrors(['show_my_spots']);

    expect($member->refresh()->getAttribute('show_my_spots'))->toBeFalse();
});

it('lists spot_alert in SET-09 with push on, and lets the member switch it off', function () {
    Sanctum::actingAs(dexMember());

    $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.notification_prefs.types.spot_alert', ['push' => true, 'web_push' => true]);
    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['spot_alert' => ['push' => false]]]])->assertOk()
        ->assertJsonPath('data.notification_prefs.types.spot_alert.push', false);

    expect(array_key_exists('spot_alert', NotificationPrefs::TYPES))->toBeTrue();
});

it('sets the public Bundesland from the public profile city only, never from the private SET-11 region (CR-P5G-08)', function () {
    dexCity('Leipzig', Bundesland::SN);
    dexCity('Mainz', Bundesland::RP);
    $member = dexMember(['city' => null]);
    Sanctum::actingAs($member);

    // A private region alone gives no Bundesland (and so no Bundesland rank).
    $this->patchJson('/api/v1/me/settings', ['home_region' => ['label' => 'Leipzig, Sachsen', 'lat' => 51.34, 'lng' => 12.37]])->assertOk();
    expect($member->refresh()->getAttribute('bundesland'))->toBeNull();

    $this->patchJson('/api/v1/me/profile', ['city' => 'Mainz'])->assertOk();
    expect($member->refresh()->getAttribute('bundesland'))->toBe(Bundesland::RP);

    // A region in another state changes nothing.
    $this->patchJson('/api/v1/me/settings', ['home_region' => ['label' => 'Leipzig, Sachsen', 'lat' => 51.34, 'lng' => 12.37]])->assertOk();
    expect($member->refresh()->getAttribute('bundesland'))->toBe(Bundesland::RP);

    $this->patchJson('/api/v1/me/profile', ['city' => null])->assertOk();
    expect($member->refresh()->getAttribute('bundesland'))->toBeNull();
});

it('recomputes every member\'s Bundesland from the public city in the data migration (CR-P5G-08)', function () {
    dexCity('Leipzig', Bundesland::SN);
    dexCity('Mainz', Bundesland::RP);
    // Written under the old rule: the region won.
    $byRegion = dexMember(['city' => 'Mainz', 'home_region_label' => 'Leipzig, Sachsen', 'bundesland' => Bundesland::SN]);
    $regionOnly = dexMember(['city' => null, 'home_region_label' => 'Leipzig, Sachsen', 'bundesland' => Bundesland::SN]);
    $right = dexMember(['city' => 'Leipzig', 'bundesland' => Bundesland::SN]);

    (require database_path('migrations/2026_12_20_100000_derive_bundesland_from_public_city.php'))->up();

    expect($byRegion->refresh()->getAttribute('bundesland'))->toBe(Bundesland::RP)
        ->and($regionOnly->refresh()->getAttribute('bundesland'))->toBeNull()
        ->and($right->refresh()->getAttribute('bundesland'))->toBe(Bundesland::SN);
});
