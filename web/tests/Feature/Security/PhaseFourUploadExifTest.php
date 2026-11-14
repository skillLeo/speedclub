<?php

use App\Models\Media;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';
require_once dirname(__DIR__).'/Social2/Social2TestHelpers.php';
require_once dirname(__DIR__).'/Maintenance/MaintenanceTestHelpers.php';

/**
 * G2 (docs/reports/security/phase-4.md §4, §13 "uploads still re-encoded with EXIF stripped"): every upload slot a member reaches in
 * Phase 4 stores no EXIF and no GPS, neither in the public variants nor in the private original. A JPEG with an Exif block and a GPS IFD
 * goes in through each slot's own route; nothing of it may come out. Collections and highlights have no upload of their own (they pick
 * build photos that went through these slots or the Garage ones, gated in Garage/GarageSecurityAuditTest).
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local']);
    evFlags();
    bizFlags();
    s2Flags();
    mntFlags();
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'jann.ptrs', 'created_at' => now()->subDays(30)]);
});

/**
 * The upload route of each slot, for the member $owner (the fixtures it needs are created here).
 */
function p4UploadUri(string $slot, User $owner): string
{
    return match ($slot) {
        'event cover' => '/api/v1/events/'.evEvent($owner)->slug.'/cover',
        'business logo', 'business cover' => (function () use ($owner, $slot): string {
            bizBusiness($owner);

            return $slot === 'business logo' ? '/api/v1/me/business/logo' : '/api/v1/me/business/cover';
        })(),
        'build update photo' => '/api/v1/build-updates/'.s2Post(publishedVehicle($owner))->id.'/media',
        'maintenance receipt' => (function () use ($owner): string {
            $vehicle = publishedVehicle($owner);

            return "/api/v1/vehicles/{$vehicle->id}/maintenance-logs/".mntLog($vehicle)->id.'/photos';
        })(),
        'member avatar' => '/api/v1/me/avatar',
        'member cover' => '/api/v1/me/cover',
        default => throw new InvalidArgumentException($slot),
    };
}

/**
 * No Exif block and, where PHP can read it, no GPS section.
 */
function p4ExpectClean(string $bytes, string $where): void
{
    expect($bytes)->not->toBe('', $where.' is empty')
        ->and(str_contains($bytes, 'Exif'))->toBeFalse($where.' keeps an Exif block')
        ->and(str_contains($bytes, 'GPS'))->toBeFalse($where.' keeps GPS');

    if (function_exists('exif_read_data') && str_starts_with($bytes, "\xFF\xD8")) {
        $data = @exif_read_data('data://image/jpeg;base64,'.base64_encode($bytes), null, true);
        expect(is_array($data) ? array_keys($data) : [])->not->toContain('GPS')->not->toContain('EXIF');
    }
}

it('stores no EXIF and no GPS from any Phase 4 upload slot, public variants and private original alike', function (string $slot) {
    $source = TestImages::jpegWithGps(1200, 900);
    expect($source)->toContain('Exif');
    $uri = p4UploadUri($slot, $this->owner);
    Sanctum::actingAs($this->owner);
    $before = Media::query()->where('owner_id', $this->owner->id)->count();

    $this->post($uri, ['file' => UploadedFile::fake()->createWithContent('standort.jpg', $source)], ['Accept' => 'application/json'])
        ->assertSuccessful();

    // One media row of the member's came of it (the profile slots answer with the profile, the others with the media).
    expect(Media::query()->where('owner_id', $this->owner->id)->count())->toBe($before + 1);

    $files = [];

    foreach (['public', 'local'] as $disk) {
        foreach (Storage::disk($disk)->allFiles() as $path) {
            $files[] = $path;
            p4ExpectClean((string) Storage::disk($disk)->get($path), "$slot: $disk/$path");
        }
    }

    // Something was stored, and never under the client's name.
    expect($files)->not->toBe([])
        ->and(implode(' ', $files))->not->toContain('standort');
})->with(['event cover', 'business logo', 'business cover', 'build update photo', 'maintenance receipt', 'member avatar', 'member cover']);
