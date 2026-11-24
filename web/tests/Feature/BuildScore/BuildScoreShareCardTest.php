<?php

use App\Models\BuildScore;
use App\Models\User;
use App\Services\Signature\ShareCards;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BuildScoreTestHelpers.php';
require_once __DIR__.'/../Signature/SignatureTestHelpers.php';

/**
 * M5.9c VEH-07 share card (m5.9c contract §4, owner gift detail M5.9d "Share card"): the Build Score gauge with its stage, and the Dex
 * number, on the 9:16 and 1:1 cards; a new score or number draws a new card (the stored name is a hash of what it shows).
 */
function bsSetScore(string $vehicleId, int $total, int $stage): void
{
    DB::table('build_scores')->updateOrInsert(['vehicle_id' => $vehicleId], ['total' => $total, 'stage' => $stage, 'formula_version' => '1', 'computed_at' => now()]);
}

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    bsFlags();
    [$this->vehicle] = sigVehicleWithPhoto(bytes: sigDetailedJpeg(1200, 800));
    $this->vehicle->forceFill(['dex_number' => 87])->save();
});

it('draws the story and the square card with the gauge at their exact size, for anybody who may see the car', function (string $format, int $width, int $height) {
    bsSetScore($this->vehicle->id, 642, 4);

    foreach ([null, User::factory()->create(), $this->vehicle->owner] as $viewer) {
        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $png = (string) $this->get("/api/v1/vehicles/{$this->vehicle->id}/share-card.png?format=$format")->assertOk()->assertHeader('Content-Type', 'image/png')->getContent();
        $size = getimagesizefromstring($png);

        expect([$size[0], $size[1]])->toBe([$width, $height]);
    }
})->with([
    'story' => ['story', 1080, 1920],
    'square' => ['square', 1080, 1080],
]);

it('draws a new card when the score, the stage or the Dex number changes', function () {
    $cards = app(ShareCards::class);
    $path = fn (): ?string => $cards->path($this->vehicle->fresh(ShareCards::RELATIONS), 'story');

    bsSetScore($this->vehicle->id, 300, 2);
    $first = $path();
    $firstPng = (string) $this->get("/api/v1/vehicles/{$this->vehicle->id}/share-card.png")->getContent();

    expect($path())->toBe($first);

    BuildScore::query()->whereKey($this->vehicle->id)->update(['total' => 325]);
    $second = $path();
    $secondPng = (string) $this->get("/api/v1/vehicles/{$this->vehicle->id}/share-card.png")->getContent();

    expect($second)->not->toBe($first)
        ->and($secondPng)->not->toBe($firstPng)
        // The gauge corner differs; the photo and text area below it keep their pixels.
        ->and(sigDifference($firstPng, $secondPng, 700, 40, 360, 400))->toBeGreaterThan(0.5)
        ->and(sigDifference($firstPng, $secondPng, 72, 1500, 500, 300))->toBe(0.0);

    $this->vehicle->forceFill(['dex_number' => 88])->save();
    expect($path())->not->toBe($second);
});

it('draws the card without a gauge before the first score', function () {
    BuildScore::query()->whereKey($this->vehicle->id)->delete();
    $without = app(ShareCards::class)->path($this->vehicle->fresh(ShareCards::RELATIONS), 'square');
    $png = (string) $this->get("/api/v1/vehicles/{$this->vehicle->id}/share-card.png?format=square")->assertOk()->getContent();

    expect(getimagesizefromstring($png)[0])->toBe(1080);

    bsSetScore($this->vehicle->id, 120, 1);
    expect(app(ShareCards::class)->path($this->vehicle->fresh(ShareCards::RELATIONS), 'square'))->not->toBe($without);
});
