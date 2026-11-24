<?php

use App\Enums\EventStatus;
use App\Enums\MediaStatus;
use App\Enums\PlateBlurState;
use App\Models\Business;
use App\Models\Event;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use App\Services\Media\ProcessMedia;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\PartnerOgImages;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';
require_once dirname(__DIR__).'/Social2/Social2TestHelpers.php';
require_once dirname(__DIR__).'/Messaging/MessagingTestHelpers.php';
require_once dirname(__DIR__).'/Signature/SignatureTestHelpers.php';

/**
 * M5.9a plate-blur leak test (10 §16.1, ADR-509, m5.9a-contract §5; a Phase 5 verify gate: `--group=plate-blur-leak`).
 *
 * Fixture: a 1600 × 1200 JPEG, flat blue-grey, with a 24 px yellow/blue checkerboard in the plate box (x 0.32, y 0.70, w 0.36, h 0.12,
 * the editor's suggested rectangle), once plain and once stored rotated with EXIF orientation 6 (the box then sits where the member saw
 * it only after orientation). Every upload endpoint of contract §1 takes it with `plate_blur=1` and that box; the (sync) queue runs; then:
 *
 * 1. Variance: every public variant (all widths; WebP) and the private original. In each, the box, scaled to the file's size and inset by
 *    10 % per side, has a summed RGB variance of at most PBL_MAX_RATIO = 5 % of the same rectangle of the fixture scaled to that width.
 *    (An unblurred file measures 45–100 %.)
 * 2. Signature: OG images (landscape + square), share cards (story 1:1 + 9:16) and every image file on the disks hold at most
 *    PBL_MAX_SIGNATURE sampled pixels of the checkerboard's saturated yellow or blue (every 3rd pixel per axis), where the control shows
 *    thousands: pixelation averages the two to grey. Where a card does not show the photo at all, the control fails, so it cannot pass
 *    by accident.
 * 3. Files: the pending upload is gone and no file anywhere under the disks holds the checkerboard.
 * The blurhash (4 × 3 DCT components) cannot carry a 24 px pattern and member uploads have no thumbhash: neither is measured.
 *
 * Control (proves the test can fail): `plate_blur=0` keeps the variance above PBL_MIN_CONTROL_RATIO = 25 % (45 % at 320 px, 80–100 %
 * above) and the signature in the OG images and cards.
 * GAR-08 later blur on a `declined` photo: same assertions. Legibility (ADR-509): across the plate's height at most 3 distinct blocks.
 */
const PBL_BOX = ['x' => 0.32, 'y' => 0.70, 'w' => 0.36, 'h' => 0.12];

const PBL_WIDTH = 1600;

const PBL_HEIGHT = 1200;

const PBL_CELL = 24;

const PBL_MAX_RATIO = 0.05;

/** The control keeps at least this share (the 320 px WebP keeps about 45 %, the larger files 80–100 %): far above PBL_MAX_RATIO. */
const PBL_MIN_CONTROL_RATIO = 0.25;

const PBL_MAX_SIGNATURE = 10;

/** Sampled checkerboard pixels a card or file must show in the control, so its "no signature" in the blurred run means something. */
const PBL_MIN_CONTROL_SIGNATURE = 300;

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local', 'speedclub.messaging.media_disk' => 'local']);
    evFlags();
    bizFlags();
    s2Flags();
    msgFlags();
    sigFlag('sig.plate_blur');
    sigFlag('sig.share_cards');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'pbl.halter', 'created_at' => now()->subDays(30)]);
});

// -- Fixture and measures

/**
 * @return array{0: int, 1: int, 2: int, 3: int} left, top, width, height of the plate box on a picture of this size
 */
function pblBox(int $width, int $height, float $inset = 0.0): array
{
    $left = PBL_BOX['x'] * $width;
    $top = PBL_BOX['y'] * $height;
    $boxWidth = PBL_BOX['w'] * $width;
    $boxHeight = PBL_BOX['h'] * $height;

    return [
        (int) round($left + $boxWidth * $inset),
        (int) round($top + $boxHeight * $inset),
        max(1, (int) round($boxWidth * (1 - 2 * $inset))),
        max(1, (int) round($boxHeight * (1 - 2 * $inset))),
    ];
}

/**
 * The displayed picture: flat background, the pattern in the plate box. `checker`: 24 px yellow/blue, light against dark and far apart
 * in colour, so it survives the 320 px variant's scaling and chroma subsampling (pixelates to flat grey: a 48 px block holds 2 × 2 cells);
 * `cells`: 24 px cells of seeded random colours (pixelates to blocks of different greys, for the legibility check).
 */
function pblPicture(string $pattern = 'checker'): GdImage
{
    $image = imagecreatetruecolor(PBL_WIDTH, PBL_HEIGHT);
    imagefilledrectangle($image, 0, 0, PBL_WIDTH - 1, PBL_HEIGHT - 1, (int) imagecolorallocate($image, 70, 80, 95));
    [$left, $top, $width, $height] = pblBox(PBL_WIDTH, PBL_HEIGHT);
    $yellow = (int) imagecolorallocate($image, 255, 255, 0);
    $blue = (int) imagecolorallocate($image, 0, 0, 255);
    mt_srand(509);

    for ($y = $top; $y < $top + $height; $y += PBL_CELL) {
        for ($x = $left; $x < $left + $width; $x += PBL_CELL) {
            $color = $pattern === 'checker'
                ? ((intdiv($x - $left, PBL_CELL) + intdiv($y - $top, PBL_CELL)) % 2 === 0 ? $yellow : $blue)
                : (mt_rand(0, 255) << 16) | (mt_rand(0, 255) << 8) | mt_rand(0, 255);
            imagefilledrectangle($image, $x, $y, min($x + PBL_CELL, $left + $width) - 1, min($y + PBL_CELL, $top + $height) - 1, $color);
        }
    }

    mt_srand();

    return $image;
}

/**
 * The upload's bytes. Orientation 6: stored turned a quarter anticlockwise with the EXIF tag that turns it back for display.
 */
function pblFixture(int $orientation = 1, string $pattern = 'checker'): string
{
    $image = pblPicture($pattern);

    if ($orientation === 6) {
        $image = imagerotate($image, 90, 0);
    }

    ob_start();
    imagejpeg($image, null, 95);
    $jpeg = (string) ob_get_clean();

    if ($orientation === 1) {
        return $jpeg;
    }

    $tiff = 'II*'."\0".pack('V', 8).pack('v', 1).pack('vvVv', 0x0112, 3, 1, $orientation)."\0\0".pack('V', 0);
    $segment = 'Exif'."\0\0".$tiff;

    return substr_replace($jpeg, "\xFF\xE1".pack('n', strlen($segment) + 2).$segment, 2, 0);
}

function pblDecode(string $bytes): GdImage
{
    $image = @imagecreatefromstring($bytes);
    expect($image)->toBeInstanceOf(GdImage::class);

    return $image;
}

/**
 * Summed variance of R, G and B over a rectangle.
 *
 * @param  array{0: int, 1: int, 2: int, 3: int}  $rect
 */
function pblVariance(GdImage $image, array $rect): float
{
    [$left, $top, $width, $height] = $rect;
    $sums = [0.0, 0.0, 0.0];
    $squares = [0.0, 0.0, 0.0];
    $count = 0;

    for ($y = $top; $y < $top + $height; $y++) {
        for ($x = $left; $x < $left + $width; $x++) {
            $color = (int) imagecolorat($image, $x, $y);

            foreach ([($color >> 16) & 255, ($color >> 8) & 255, $color & 255] as $channel => $value) {
                $sums[$channel] += $value;
                $squares[$channel] += $value * $value;
            }

            $count++;
        }
    }

    $variance = 0.0;

    foreach ([0, 1, 2] as $channel) {
        $mean = $sums[$channel] / max(1, $count);
        $variance += $squares[$channel] / max(1, $count) - $mean * $mean;
    }

    return $variance;
}

/**
 * Sampled pixels (every 3rd per axis) of the checkerboard's saturated yellow or blue anywhere in the picture.
 */
function pblSignature(GdImage $image): int
{
    $hits = 0;

    for ($y = 0, $height = imagesy($image); $y < $height; $y += 3) {
        for ($x = 0, $width = imagesx($image); $x < $width; $x += 3) {
            $color = (int) imagecolorat($image, $x, $y);
            [$r, $g, $b] = [($color >> 16) & 255, ($color >> 8) & 255, $color & 255];

            if (($r > $b + 90 && $g > $b + 90 && abs($r - $g) < 60) || ($b > $r + 90 && $b > $g + 90)) {
                $hits++;
            }
        }
    }

    return $hits;
}

/**
 * The box of a file of the photo against the same box of the fixture at that width: blurred well under PBL_MAX_RATIO, the control near 1.
 */
function pblRatio(string $bytes): float
{
    $image = pblDecode($bytes);
    [$width, $height] = [imagesx($image), imagesy($image)];
    $reference = $width === PBL_WIDTH ? pblPicture() : imagescale(pblPicture(), $width, $height);
    $rect = pblBox($width, $height, 0.1);

    return pblVariance($image, $rect) / max(1.0, pblVariance($reference, $rect));
}

// -- Endpoints (contract §1)

/**
 * Creates what the endpoint needs and answers [upload URI, the parent, the member who may also read it].
 *
 * @return array{0: string, 1: Vehicle|Modification|Event|Business|User|null, 2: User|null}
 */
function pblEndpoint(string $endpoint, User $owner): array
{
    return match ($endpoint) {
        'vehicle' => (function () use ($owner): array {
            $vehicle = Vehicle::factory()->published()->create(['owner_id' => $owner->id]);

            return ["/api/v1/vehicles/{$vehicle->id}/media", $vehicle, null];
        })(),
        'modification' => (function () use ($owner): array {
            $vehicle = Vehicle::factory()->published()->create(['owner_id' => $owner->id]);
            $mod = Modification::factory()->create(['vehicle_id' => $vehicle->id]);

            return ["/api/v1/mods/{$mod->id}/media", $mod, null];
        })(),
        'build update' => (function () use ($owner): array {
            $update = s2Post(Vehicle::factory()->published()->create(['owner_id' => $owner->id]));

            return ["/api/v1/build-updates/{$update->id}/media", $update->vehicle, null];
        })(),
        'message' => (function () use ($owner): array {
            $partner = ntfMember('pbl.partner');
            $conversation = msgStart($partner, $owner, 'Zeig mal dein Heck.')->conversation_id;

            return ["/api/v1/conversations/{$conversation}/media", null, $partner];
        })(),
        'profile cover' => ['/api/v1/me/cover', $owner, null],
        'event cover' => (function () use ($owner): array {
            $event = evEvent($owner);

            return ['/api/v1/events/'.$event->slug.'/cover', $event, null];
        })(),
        'business cover' => ['/api/v1/me/business/cover', bizBusiness($owner), null],
        default => throw new InvalidArgumentException($endpoint),
    };
}

/**
 * @param  array<string, string>  $fields
 */
function pblUpload(string $uri, string $bytes, array $fields): TestResponse
{
    return test()->post($uri, ['file' => UploadedFile::fake()->createWithContent('heck.jpg', $bytes), ...$fields], ['Accept' => 'application/json']);
}

/**
 * @return array{plate_blur: string, blur_regions: string}
 */
function pblBlurOn(): array
{
    return ['plate_blur' => '1', 'blur_regions' => (string) json_encode([PBL_BOX])];
}

function pblNewestMedia(User $owner): Media
{
    return Media::query()->where('owner_id', $owner->id)->latest('id')->firstOrFail();
}

/**
 * Bytes behind a URL: a file of the local public disk by its path, anything else through the HTTP kernel.
 */
function pblFetch(string $url): string
{
    $storage = url('storage').'/';

    if (str_starts_with($url, $storage)) {
        $bytes = Storage::disk('public')->get(substr($url, strlen($storage)));
        expect($bytes)->not->toBeNull("$url is not on the public disk");

        return (string) $bytes;
    }

    $response = test()->get($url);
    $response->assertOk();

    return match (true) {
        $response->baseResponse instanceof BinaryFileResponse => (string) file_get_contents($response->baseResponse->getFile()->getPathname()),
        $response->baseResponse instanceof StreamedResponse => $response->streamedContent(),
        default => (string) $response->getContent(),
    };
}

/**
 * Every URL string in an API answer that names a file of this photo.
 *
 * @return list<string>
 */
function pblPhotoUrls(mixed $json, Media $media): array
{
    $urls = [];
    $id = strtolower($media->id);

    array_walk_recursive($json, function (mixed $value) use (&$urls, $id, $media): void {
        if (is_string($value) && (str_contains($value, "media/$id/") || str_contains($value, 'chat-media/'.$media->id))) {
            $urls[] = $value;
        }
    });

    return array_values(array_unique($urls));
}

/**
 * The OG images and share cards a guest can load for what the photo belongs to, by kind.
 *
 * @return array<string, string>
 */
function pblCardUrls(Media $media): array
{
    $parent = $media->mediable;
    $owner = User::query()->findOrFail($media->owner_id);

    return match (true) {
        $parent instanceof Vehicle => [
            ...array_combine(['og landscape', 'og square'], array_values(app(OgImages::class)->cards($parent->fresh(OgImages::VEHICLE_RELATIONS)))),
            'share story' => "/api/v1/vehicles/{$parent->id}/share-card.png?format=story",
            'share square' => "/api/v1/vehicles/{$parent->id}/share-card.png?format=square",
        ],
        $parent instanceof User => array_combine(['og landscape', 'og square'], array_values(app(OgImages::class)->cards($owner->fresh(OgImages::MEMBER_RELATIONS)))),
        $parent instanceof Event, $parent instanceof Business => array_combine(['og landscape', 'og square'], array_values(app(PartnerOgImages::class)->cards(pblApproved($parent)))),
        default => [],
    };
}

/**
 * A new cover sends a pre-moderated event back to review (UpdateEvent::reviewAgainIfNeeded); staff approve it here, so its card is public.
 */
function pblApproved(Event|Business $parent): Event|Business
{
    if ($parent instanceof Event) {
        Event::query()->whereKey($parent->id)->update(['status' => EventStatus::Published]);
    }

    return $parent->fresh() ?? $parent;
}

/**
 * Every image file on both disks with the number of signature pixels it holds, and every pending upload left.
 *
 * @return array{signatures: array<string, int>, pending: list<string>}
 */
function pblScanDisks(): array
{
    $signatures = [];
    $pending = [];

    foreach (['public', 'local'] as $disk) {
        foreach (Storage::disk($disk)->allFiles() as $path) {
            if (str_ends_with($path, 'pending.bin')) {
                $pending[] = "$disk/$path";
            }

            $image = @imagecreatefromstring((string) Storage::disk($disk)->get($path));

            if ($image instanceof GdImage) {
                $signatures["$disk/$path"] = pblSignature($image);
            }
        }
    }

    return ['signatures' => $signatures, 'pending' => $pending];
}

/**
 * Everything a viewer or the disk can give of the photo, measured. `blurred`: the box gone everywhere; otherwise (control): it is there.
 *
 * @param  list<string>  $urls  the photo's URLs as an API answer gave them
 */
function pblAssertPhoto(Media $media, array $urls, bool $blurred): void
{
    $media->refresh();
    expect($media->status)->toBe(MediaStatus::Ready)
        ->and([$media->width, $media->height])->toBe([PBL_WIDTH, PBL_HEIGHT])
        ->and($urls)->not->toBe([]);

    // 1. Every variant (all widths) by the URLs the API answered and by the paths of the row, and the private original.
    $files = [];

    foreach ($urls as $url) {
        $files[$url] = pblFetch($url);
    }

    $disk = Storage::disk((string) $media->getAttribute('disk'));

    foreach ($media->variants ?? [] as $width => $path) {
        $files["variant $width"] = (string) $disk->get($path);
    }

    $files['private original'] = (string) Storage::disk('local')->get((string) $media->getAttribute('original_path'));
    expect(count($media->variants ?? []))->toBeGreaterThanOrEqual(4);

    foreach ($files as $where => $bytes) {
        $ratio = pblRatio($bytes);
        $blurred
            ? expect($ratio)->toBeLessThanOrEqual(PBL_MAX_RATIO, "$where shows the plate box (variance ratio $ratio)")
            : expect($ratio)->toBeGreaterThan(PBL_MIN_CONTROL_RATIO, "control: $where lost the plate box (variance ratio $ratio)");
    }

    // 2. OG images and share cards, through the routes a crawler or a share sheet loads.
    foreach (pblCardUrls($media) as $card => $url) {
        $signature = pblSignature(pblDecode(pblFetch($url)));
        $blurred
            ? expect($signature)->toBeLessThanOrEqual(PBL_MAX_SIGNATURE, "$card shows the plate box ($signature pixels)")
            : expect($signature)->toBeGreaterThan(PBL_MIN_CONTROL_SIGNATURE, "control: $card does not show the photo ($signature pixels)");
    }

    // 3. The disks: no pending upload, and in the blurred run no file with the checkerboard.
    $scan = pblScanDisks();
    expect($scan['pending'])->toBe([]);

    if ($blurred) {
        foreach ($scan['signatures'] as $path => $signature) {
            expect($signature)->toBeLessThanOrEqual(PBL_MAX_SIGNATURE, "$path holds the plate box ($signature pixels)");
        }
    } else {
        expect(max($scan['signatures']))->toBeGreaterThan(PBL_MIN_CONTROL_SIGNATURE);
    }
}

// -- The gate

const PBL_ENDPOINTS = ['vehicle', 'modification', 'build update', 'message', 'profile cover', 'event cover', 'business cover'];

it('serves no unblurred pixel of the plate box from any public URL or file, with plate_blur=1', function (string $endpoint, int $orientation) {
    [$uri] = pblEndpoint($endpoint, $this->owner);
    Sanctum::actingAs($this->owner);

    $answer = pblUpload($uri, pblFixture($orientation), pblBlurOn())->assertSuccessful();
    $media = pblNewestMedia($this->owner);

    expect($media->plate_blur)->toBe(PlateBlurState::Blurred)
        ->and($media->blur_regions)->toBeNull()
        ->and($media->blurred_at)->not->toBeNull();

    pblAssertPhoto($media, pblPhotoUrls($answer->json(), $media), blurred: true);
})->with(PBL_ENDPOINTS)->with(['upright' => 1, 'EXIF orientation 6' => 6])->group('plate-blur-leak');

it('keeps the plate box with plate_blur=0, so the measures can fail (control)', function (string $endpoint) {
    [$uri] = pblEndpoint($endpoint, $this->owner);
    Sanctum::actingAs($this->owner);

    $answer = pblUpload($uri, pblFixture(), ['plate_blur' => '0', 'blur_regions' => (string) json_encode([PBL_BOX])])->assertSuccessful();
    $media = pblNewestMedia($this->owner);

    expect($media->plate_blur)->toBe(PlateBlurState::Declined)->and($media->blurred_at)->toBeNull();

    pblAssertPhoto($media, pblPhotoUrls($answer->json(), $media), blurred: false);
})->with(PBL_ENDPOINTS)->group('plate-blur-leak');

it('pixelates a declined photo later with GAR-08 and leaves nothing unblurred behind', function (string $endpoint) {
    [$uri] = pblEndpoint($endpoint, $this->owner);
    Sanctum::actingAs($this->owner);

    pblUpload($uri, pblFixture(), ['plate_blur' => '0'])->assertSuccessful();
    $media = pblNewestMedia($this->owner);
    expect($media->plate_blur)->toBe(PlateBlurState::Declined);
    // The cards are drawn from the unblurred photo first, as on a live build, so the purge has something to take down.
    pblCardUrls($media);

    $this->patchJson("/api/v1/media/{$media->id}", ['blur_regions' => [PBL_BOX]])->assertOk();

    // The sync queue has run BlurMedia: the photo is back under new names, which the API gives as MediaResource does.
    expect($media->refresh()->plate_blur)->toBe(PlateBlurState::Blurred);
    pblAssertPhoto($media, array_values(app(MediaService::class)->variantUrls($media)), blurred: true);
})->with(['vehicle', 'build update', 'profile cover'])->group('plate-blur-leak');

it('keeps no unblurred bytes when the upload waits for the queue', function () {
    [$uri] = pblEndpoint('vehicle', $this->owner);
    Sanctum::actingAs($this->owner);
    Queue::fake();
    // A public disk that refuses every write: the master is rendered and stored privately, the variants fail.
    config(['filesystems.disks.pbl_broken' => ['driver' => 'local', 'root' => '/dev/null/pbl', 'throw' => false], 'speedclub.media.disk' => 'pbl_broken']);

    pblUpload($uri, pblFixture(), pblBlurOn())->assertCreated()->assertJsonPath('data.status', 'processing');
    $media = pblNewestMedia($this->owner);
    $pending = 'media/'.strtolower($media->id).'/pending.bin';

    // What waits is the rendered master with the box already pixelated, never the upload.
    expect(Storage::disk('local')->exists($pending))->toBeTrue()
        ->and(pblRatio((string) Storage::disk('local')->get($pending)))->toBeLessThanOrEqual(PBL_MAX_RATIO)
        ->and($media->blur_regions)->toBeNull()
        ->and($media->blurred_at)->not->toBeNull();
    Queue::assertPushed(ProcessMedia::class);

    // The queue runs once the disk works again.
    config(['speedclub.media.disk' => 'public']);
    $media->forceFill(['disk' => 'public'])->save();
    (new ProcessMedia($media->id))->handle(app(MediaService::class));

    $answer = $this->getJson("/api/v1/vehicles/{$media->mediable_id}")->assertOk();
    pblAssertPhoto($media, pblPhotoUrls($answer->json(), $media), blurred: true);
})->group('plate-blur-leak');

it('pixelates the upload in the queued retry when the in-request work failed before rendering, and deletes it', function () {
    [, $vehicle] = pblEndpoint('vehicle', $this->owner);
    Queue::fake();
    $service = app(MediaService::class);
    $media = $service->reserve($this->owner, $vehicle, plateBlur: PlateBlurChoice::blurred([PBL_BOX]));
    $pending = 'media/'.strtolower($media->id).'/pending.bin';
    // The raw upload waits only here, privately (contract §2): the queue job carries the id alone.
    Storage::disk('local')->put($pending, pblFixture(6));
    Queue::assertNothingPushed();

    (new ProcessMedia($media->id))->handle($service);

    Sanctum::actingAs($this->owner);
    $answer = $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertOk();
    expect(Storage::disk('local')->exists($pending))->toBeFalse();
    pblAssertPhoto($media, pblPhotoUrls($answer->json(), $media), blurred: true);

    // A job that gives up deletes the waiting upload with everything else of the photo.
    $other = $service->reserve($this->owner, $vehicle, plateBlur: PlateBlurChoice::blurred([PBL_BOX]));
    Storage::disk('local')->put('media/'.strtolower($other->id).'/pending.bin', pblFixture());
    (new ProcessMedia($other->id))->failed(new RuntimeException('disk full'));
    expect(Storage::disk('local')->allFiles('media/'.strtolower($other->id)))->toBe([])
        ->and($other->refresh()->status)->toBe(MediaStatus::Failed)
        ->and(serialize(new ProcessMedia($other->id)))->not->toContain('JFIF');
})->group('plate-blur-leak');

it('leaves at most 3 blocks across the plate height (ADR-509 legibility)', function (bool $blurred) {
    [$uri] = pblEndpoint('vehicle', $this->owner);
    Sanctum::actingAs($this->owner);

    pblUpload($uri, pblFixture(1, 'cells'), $blurred ? pblBlurOn() : ['plate_blur' => '0'])->assertCreated();
    $media = pblNewestMedia($this->owner);
    $variants = $media->variants ?? [];
    $widest = (string) max(array_keys($variants));

    foreach (['private original' => Storage::disk('local')->get((string) $media->getAttribute('original_path')), 'widest variant' => Storage::disk('public')->get($variants[$widest])] as $where => $bytes) {
        $image = pblDecode((string) $bytes);
        [$left, $top, $width, $height] = pblBox(imagesx($image), imagesy($image));
        $most = 0;

        // Distinct colours down a column: pixels grouped greedily by their distance (|ΔR|+|ΔG|+|ΔB| ≤ 45) to a group's first pixel; a group
        // of at least 12 px (a quarter of the 48 px block at 1600 px) is a block. The encoder's ringing at a block edge forms no group of
        // that size. The control's 24 px cells of random colours count as up to 6.
        for ($x = $left + 6; $x < $left + $width - 6; $x += 24) {
            $groups = [];

            for ($y = $top; $y < $top + $height; $y++) {
                $color = (int) imagecolorat($image, $x, $y);
                $rgb = [($color >> 16) & 255, ($color >> 8) & 255, $color & 255];
                $found = false;

                foreach ($groups as $index => [$anchor, $size]) {
                    if (abs($rgb[0] - $anchor[0]) + abs($rgb[1] - $anchor[1]) + abs($rgb[2] - $anchor[2]) <= 45) {
                        $groups[$index][1] = $size + 1;
                        $found = true;

                        break;
                    }
                }

                if (! $found) {
                    $groups[] = [$rgb, 1];
                }
            }

            $most = max($most, count(array_filter($groups, fn (array $group): bool => $group[1] >= 12)));
        }

        $blurred
            ? expect($most)->toBeLessThanOrEqual(3, "$where: $most blocks across the plate")
            : expect($most)->toBeGreaterThan(3, "control: $where should show the 6 cells across the plate");
    }
})->with(['pixelated' => true, 'control' => false])->group('plate-blur-leak');

it('pixelates a turned rectangle through the upload and leaves the photo outside it untouched', function () {
    [$uri] = pblEndpoint('vehicle', $this->owner);
    Sanctum::actingAs($this->owner);
    // The plate box turned 20° clockwise about its centre: its centre is covered, the corner strip of the unturned box below the turned
    // rectangle's left end is not (turned back into the rectangle's own frame it lies 60 px under its lower edge).
    $turned = [...PBL_BOX, 'angle' => 20];

    pblUpload($uri, pblFixture(), ['plate_blur' => '1', 'blur_regions' => (string) json_encode([$turned])])->assertCreated();
    $media = pblNewestMedia($this->owner);
    expect($media->plate_blur)->toBe(PlateBlurState::Blurred)->and($media->blur_regions)->toBeNull();

    $original = pblDecode((string) Storage::disk('local')->get((string) $media->getAttribute('original_path')));
    $reference = pblPicture();
    [$left, $top, $width, $height] = pblBox(PBL_WIDTH, PBL_HEIGHT);
    $centre = [$left + intdiv($width, 2) - 48, $top + intdiv($height, 2) - 24, 96, 48];
    $corner = [$left, $top + $height - 48, 48, 48];

    expect(pblVariance($original, $centre) / max(1.0, pblVariance($reference, $centre)))->toBeLessThanOrEqual(PBL_MAX_RATIO)
        ->and(pblVariance($original, $corner) / max(1.0, pblVariance($reference, $corner)))->toBeGreaterThan(0.8);
})->group('plate-blur-leak');
