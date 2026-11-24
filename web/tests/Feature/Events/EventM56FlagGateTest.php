<?php

use App\Models\FeatureFlag;
use App\Models\User;
use Database\Seeders\FeatureFlagSeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 flags (m5.6-contract §3): `events.gallery` and `events.checkin` are off by default; every route of a flag that is off answers 404
 * feature_disabled (after `member`, so a guest hears 401 first on member routes), a child flag of an off `events` is off, and the event
 * detail leaves the new fields out (not null) so an older app sees nothing new.
 */
beforeEach(function () {
    $this->organiser = evOrganiser();
    $this->event = m56JustEnded($this->organiser);
    $this->photo = '01jab3cdefghjkmnpqrstvwxyz';
});

dataset('m56 member routes', [
    'gallery upload' => ['events.gallery', 'POST', '/gallery'],
    'gallery approve' => ['events.gallery', 'POST', '/gallery/01JAB3CDEFGHJKMNPQRSTVWXYZ/approve'],
    'gallery reject' => ['events.gallery', 'POST', '/gallery/01JAB3CDEFGHJKMNPQRSTVWXYZ/reject'],
    'gallery delete' => ['events.gallery', 'DELETE', '/gallery/01JAB3CDEFGHJKMNPQRSTVWXYZ'],
    'checkin code' => ['events.checkin', 'GET', '/checkin-code'],
    'checkin' => ['events.checkin', 'POST', '/checkin'],
    'checkin patch' => ['events.checkin', 'PATCH', '/checkin'],
    'checkin delete' => ['events.checkin', 'DELETE', '/checkin'],
]);

it('answers 404 feature_disabled on member routes while the flag is off, after 401 for guests', function (string $flag, string $method, string $suffix) {
    m56Flags(gallery: $flag !== 'events.gallery', checkin: $flag !== 'events.checkin');
    $path = "/api/v1/events/{$this->event->slug}$suffix";

    $this->json($method, $path)->assertUnauthorized();

    Sanctum::actingAs($this->organiser);
    $this->json($method, $path)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
})->with('m56 member routes');

it('is off with `events` off, whatever the child flag says', function (string $flag, string $method, string $suffix) {
    m56Flags();
    evFlags(['events' => false, 'events.gallery' => true, 'events.checkin' => true]);
    Sanctum::actingAs($this->organiser);

    $this->json($method, "/api/v1/events/{$this->event->slug}$suffix")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
})->with('m56 member routes');

it('answers 404 feature_disabled on the guest reads and me/checkins while off', function () {
    m56Flags(gallery: false, checkin: false);
    $member = User::factory()->create(['username' => 'mia.k']);

    $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/public/users/mia.k/checkins')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->getJson('/api/v1/me/checkins')->assertUnauthorized();

    Sanctum::actingAs($member);
    $this->getJson('/api/v1/me/checkins')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});

it('is off by default after the seeders', function () {
    $this->seed(FeatureFlagSeeder::class);

    expect(FeatureFlag::query()->whereIn('key', ['events.gallery', 'events.checkin'])->pluck('enabled', 'key')->all())
        ->toBe(['events.checkin' => false, 'events.gallery' => false]);
});

it('leaves the detail fields out while the flags are off, and adds them when on', function () {
    m56Flags(gallery: false, checkin: false);
    Sanctum::actingAs($this->organiser);

    $off = $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
        ->assertJsonMissingPath('data.gallery')->assertJsonMissingPath('data.checkin');
    expect($off->json('data.can'))->not->toHaveKeys(['add_photos', 'moderate_photos', 'checkin', 'show_checkin_code']);

    m56Flags();
    $on = $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
        ->assertJsonPath('data.gallery.open', true)->assertJsonPath('data.checkin.open', true);
    expect($on->json('data.can'))->toHaveKeys(['add_photos', 'moderate_photos', 'checkin', 'show_checkin_code']);
});
