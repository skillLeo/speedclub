<?php

use App\Enums\PlateBlurState;
use App\Models\AuditEvent;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;
use App\Support\Codes;
use chillerlan\QRCode\QRCode as Library;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';
require_once __DIR__.'/../Signature/SignatureTestHelpers.php';
require_once __DIR__.'/../Wrapped/WrappedTestHelpers.php';

/**
 * ADR-514 (SEC-P5G-01): every picture the server draws for sharing encodes the car's public page /v/{slug}, never the sticker code, so
 * nobody can read a code off an OG image, a share card or a Wrapped card and "spot" the car from afar. Each image type is decoded with
 * the QR library the sticker Scan-Test uses, and every code-shaped token of what it says is sent to POST spots.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    Storage::fake(config()->string('speedclub.media.private_disk'));
    sigFlag('sig.share_cards');
    $this->spotter = dexMember();
});

function sdqDecode(string $image): string
{
    return readQrText($image);
}

/**
 * The decoded text is the car's page on the app host, holds no sticker code of the car, and no code-shaped part of it counts as a spot.
 */
function sdqAssertPageOnly(string $decoded, Vehicle $vehicle, string $sticker, User $spotter): void
{
    expect($decoded)->toBe(app(QrCodes::class)->pageUrl($vehicle))
        ->and($decoded)->toStartWith(rtrim(config()->string('app.url'), '/').'/v/')
        ->and(strtoupper($decoded))->not->toContain(strtoupper($sticker))
        ->and(strtoupper($decoded))->not->toContain('/C/');

    preg_match_all('/[0-9A-Za-z]{8}/', (string) parse_url($decoded, PHP_URL_PATH), $tokens);
    $candidates = array_values(array_filter(array_unique(array_map('strtoupper', $tokens[0])), fn (string $token): bool => Codes::isValid($token)));

    foreach ($candidates as $candidate) {
        dexSpot($spotter, $candidate)->assertNotFound()->assertJsonPath('code', 'qr_not_found');
    }
}

it('draws the page address into both OG images, never the sticker code', function () {
    [$vehicle] = sigVehicleWithPhoto();
    $sticker = (string) $vehicle->activeQrCode?->code;

    app(OgImages::class)->draw(Vehicle::query()->findOrFail($vehicle->id));
    $files = Storage::disk('public')->files('og/v');

    expect($files)->toHaveCount(2);

    foreach ($files as $file) {
        sdqAssertPageOnly(sdqDecode((string) Storage::disk('public')->get($file)), $vehicle, $sticker, $this->spotter);
    }

    // The control: the sticker itself still counts, so the refusals above are about the image, not a broken spot route.
    dexSpot($this->spotter, $sticker)->assertCreated();
});

it('draws the page address into both share cards a guest may download, never the sticker code', function (string $format) {
    [$vehicle] = sigVehicleWithPhoto();
    $sticker = (string) $vehicle->activeQrCode?->code;

    $png = (string) $this->get("/api/v1/vehicles/{$vehicle->id}/share-card.png?format=$format")->assertOk()->getContent();

    sdqAssertPageOnly(sdqDecode($png), $vehicle, $sticker, $this->spotter);
})->with(['story', 'square']);

it('hands the app and draws into every Wrapped card the page address, never the sticker code', function () {
    wrFlags();
    wrRelease();
    $this->travelTo(wrNow());
    [$vehicle, $photo] = sigVehicleWithPhoto(User::factory()->create(['username' => 'wrapped.qr']));
    $photo->forceFill(['plate_blur' => PlateBlurState::Declined])->save();
    $owner = $vehicle->owner;
    $sticker = (string) $vehicle->activeQrCode?->code;
    wrMod($vehicle, 'suspension');
    wrMod($vehicle, 'wheels_tires');
    app(WrappedGenerator::class)->generate($owner, Season::from(WR_SEASON));

    Sanctum::actingAs($owner);
    $cards = $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk()->json('data.cards');
    $share = collect($cards)->firstWhere('kind', 'share');

    expect($share['qr_url'])->toBe(app(QrCodes::class)->pageUrl($vehicle))
        ->and($share['qr_svg'])->toContain('<svg')
        ->and((string) json_encode($cards))->not->toContain($sticker);

    $decoded = [];

    foreach (array_keys($cards) as $index) {
        $png = (string) $this->get('/api/v1/me/wrapped/'.WR_SEASON.'/cards/'.($index + 1).'.png')->assertOk()->getContent();

        try {
            $decoded[$cards[$index]['kind']] = sdqDecode($png);
        } catch (Throwable) {
            // A card without a QR.
        }
    }

    expect($decoded)->toHaveKey('share');

    foreach ($decoded as $text) {
        sdqAssertPageOnly($text, $vehicle, $sticker, $this->spotter);
    }
});

it('gives the Wrapped share card no QR while the car is private', function () {
    wrFlags();
    wrRelease();
    $this->travelTo(wrNow());
    $owner = User::factory()->create();
    $car = wrCar($owner);
    wrMod($car);
    QrCode::factory()->create(['vehicle_id' => $car->id]);
    app(WrappedGenerator::class)->generate($owner, Season::from(WR_SEASON));
    $car->forceFill(['visibility' => 'private'])->save();

    Sanctum::actingAs($owner);
    $share = collect($this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk()->json('data.cards'))->firstWhere('kind', 'share');

    expect($share['qr_url'])->toBeNull()->and($share['qr_svg'])->toBeNull();
});

describe('speedclub:qr:rotate-samples', function () {
    it('gives every sample car a new sticker code and leaves real cars alone', function () {
        [$sample, $sampleCode] = dexCar(attributes: ['is_sample' => true]);
        [$ofSampleOwner, $ownerCode] = dexCar(dexMember(['is_sample' => true]));
        [$real, $realCode] = dexCar();

        $this->artisan('speedclub:qr:rotate-samples --dry-run')->expectsOutputToContain('2 sample car(s)')->assertSuccessful();
        expect(QrCode::query()->where('code', $sampleCode)->value('status')->value)->toBe('active');

        $this->artisan('speedclub:qr:rotate-samples')->assertSuccessful();

        foreach ([[$sample, $sampleCode], [$ofSampleOwner, $ownerCode]] as [$car, $old]) {
            expect(QrCode::query()->where('code', $old)->value('status')->value)->toBe('revoked')
                ->and($car->qrCodes()->where('status', 'active')->count())->toBe(1)
                ->and($car->qrCodes()->where('status', 'active')->value('code'))->not->toBe($old);
        }

        expect(QrCode::query()->where('code', $realCode)->value('status')->value)->toBe('active')
            ->and($real->qrCodes()->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'qr.sample_rotated')->count())->toBe(2)
            ->and((string) json_encode(AuditEvent::query()->where('action', 'qr.sample_rotated')->get(['before', 'after'])))->not->toContain($sampleCode);
        dexSpot($this->spotter, $sampleCode)->assertStatus(409);
    });

    it('refuses in production', function () {
        [, $code] = dexCar(attributes: ['is_sample' => true]);
        app()->detectEnvironment(fn () => 'production');

        try {
            $this->artisan('speedclub:qr:rotate-samples')->assertFailed();
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }

        expect(QrCode::query()->where('code', $code)->value('status')->value)->toBe('active');
    });
});
