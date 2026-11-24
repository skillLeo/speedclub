<?php

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\PlateBlurState;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\Wrapped;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedCardImages;
use App\Services\Wrapped\WrappedGenerator;
use App\Support\DesignTokens;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/WrappedTestHelpers.php';

/**
 * ADR-516 a (DQ-P5G-05): the intro, Build Score and Build Spirit cards carry a photo of the member's own car the card is about, chosen at
 * generation (`media_id`) and read again per request (`image`, WrappedMedia::usableCarPhoto); spots and Treffen never carry one. The
 * server PNGs of those cards draw the same photo, from the public (blurred) variants only.
 *
 * Fixture: car A has the season's Build Score (so it is the score and share car, and the intro's lead car) and one exhaust mod; car B
 * has three suspension mods, so the Build Spirit is Shakotan Artist and is about car B.
 */
beforeEach(function () {
    wrFlags();
    wrRelease();
    $this->travelTo(wrNow());
    $this->public = Storage::fake('public');
    $this->private = Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->owner = User::factory()->create();
    $this->carA = wrCar($this->owner, ['dex_number' => 12]);
    $this->carB = wrCar($this->owner);
    wrMod($this->carA, 'exhaust', ['title' => 'Akrapovič Evolution']);
    foreach (range(1, 3) as $i) {
        wrMod($this->carB, 'suspension', ['title' => "Fahrwerk $i"]);
    }
    wrScore($this->carA, 640, ['2027-06-01' => 640]);
    $this->coverA = wrPhoto($this->carA, $this->owner);
    $this->coverB = wrPhoto($this->carB, $this->owner, PlateBlurState::Declined);
    $this->carA->forceFill(['cover_media_id' => $this->coverA->id])->save();
    $this->carB->forceFill(['cover_media_id' => $this->coverB->id])->save();
});

function wrpGenerate(User $owner): Wrapped
{
    $wrapped = app(WrappedGenerator::class)->generate($owner, Season::from(WR_SEASON));
    expect($wrapped)->not->toBeNull();

    return $wrapped;
}

/** @return array<string, array<string, mixed>> the stored cards by kind */
function wrpStored(Wrapped $wrapped): array
{
    return collect($wrapped->refresh()->cards())->keyBy('kind')->all();
}

/** @return array<string, array<string, mixed>> the API's cards by kind */
function wrpRead(User $owner): array
{
    Sanctum::actingAs($owner);

    return collect(test()->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk()->json('data.cards'))->keyBy('kind')->all();
}

/** The photo's 1080 variant is somewhere in the image object. */
function wrpShows(?array $image, Media $media): bool
{
    return is_array($image) && str_contains((string) $image['url'], (string) $media->variants['1080']) && count($image['variants']) === 4
        && array_key_exists('blurhash', $image) && array_key_exists('focal_x', $image);
}

/** A solid picture as the variant files (the public, blurred side) and a different one as the private original. */
function wrpPaint(Media $media, array $variant, array $original = [220, 20, 20]): void
{
    $solid = function (array $rgb): string {
        $image = imagecreatetruecolor(800, 533);
        imagefill($image, 0, 0, (int) imagecolorallocate($image, ...$rgb));
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    };

    foreach ($media->variants as $path) {
        test()->public->put($path, $solid($variant));
    }

    test()->private->put($media->original_path, $solid($original));
}

/** @return array{0: int, 1: int, 2: int} */
function wrpPixel(string $png, int $x, int $y): array
{
    $image = imagecreatefromstring($png);
    $color = (int) imagecolorat($image, $x, $y);

    return [($color >> 16) & 0xFF, ($color >> 8) & 0xFF, $color & 0xFF];
}

function wrpPosition(Wrapped $wrapped, string $kind): int
{
    return (int) array_search($kind, array_column($wrapped->cards(), 'kind'), true) + 1;
}

it('stores the photo of the car each card is about, and the API answers it', function () {
    $wrapped = wrpGenerate($this->owner);
    $stored = wrpStored($wrapped);

    expect(array_keys($stored))->toContain('intro', 'score', 'build_spirit', 'share')
        ->and($stored['build_spirit']['key'])->toBe('shakotan_artist')
        ->and($stored['score']['vehicle_id'])->toBe($this->carA->id)
        ->and($stored['share']['vehicle_id'])->toBe($this->carA->id)
        ->and($stored['intro']['media_id'])->toBe($this->coverA->id)
        ->and($stored['score']['media_id'])->toBe($this->coverA->id)
        ->and($stored['share']['media_id'])->toBe($this->coverA->id)
        ->and($stored['build_spirit']['media_id'])->toBe($this->coverB->id);

    $cards = wrpRead($this->owner);

    expect(wrpShows($cards['intro']['image'], $this->coverA))->toBeTrue()
        ->and(wrpShows($cards['score']['image'], $this->coverA))->toBeTrue()
        ->and(wrpShows($cards['build_spirit']['image'], $this->coverB))->toBeTrue()
        ->and($cards['intro']['image'])->toBe($cards['share']['image']);
});

it('takes the car\'s first usable photo when the cover may not be shown, and none of another car', function () {
    $this->coverB->forceFill(['plate_blur' => PlateBlurState::Unchecked])->save();
    $second = wrPhoto($this->carB, $this->owner, attributes: ['sort' => 5]);
    wrPhoto($this->carB, $this->owner, PlateBlurState::Unchecked, ['sort' => 1]);

    expect(wrpStored(wrpGenerate($this->owner))['build_spirit']['media_id'])->toBe($second->id);

    $second->forceFill(['plate_blur' => PlateBlurState::Unchecked])->save();

    // Car A has a usable photo, but the spirit is about car B: it stays typographic.
    expect(wrpStored(wrpGenerate($this->owner))['build_spirit']['media_id'])->toBeNull()
        ->and(wrpRead($this->owner)['build_spirit']['image'])->toBeNull();
});

it('stores no photo at generation that is not the member\'s own or not plate-checked', function (Closure $spoil) {
    $spoil($this);
    $stored = wrpStored(wrpGenerate($this->owner));
    $cards = wrpRead($this->owner);

    expect($stored['intro']['media_id'])->toBeNull()
        ->and($stored['score']['media_id'])->toBeNull()
        ->and($cards['intro']['image'])->toBeNull()
        ->and($cards['score']['image'])->toBeNull()
        ->and(wrpShows($cards['build_spirit']['image'], $this->coverB))->toBeTrue();
})->with([
    'unchecked plate' => [fn ($t) => $t->coverA->forceFill(['plate_blur' => PlateBlurState::Unchecked])->save()],
    'another member\'s photo as the cover' => [function ($t) {
        $foreign = wrPhoto($t->carA, User::factory()->create());
        $t->coverA->forceDelete();
        $t->carA->forceFill(['cover_media_id' => $foreign->id])->save();
    }],
    'rejected' => [fn ($t) => $t->coverA->forceFill(['moderation_status' => ModerationStatus::Rejected])->save()],
    'still processing' => [fn ($t) => $t->coverA->forceFill(['status' => MediaStatus::Processing])->save()],
    'deleted' => [fn ($t) => $t->coverA->delete()],
]);

it('reads the photo again on every request: a photo spoiled after generation disappears', function (Closure $spoil) {
    wrpGenerate($this->owner);
    $spoil($this);
    $cards = wrpRead($this->owner);

    expect($cards['intro']['image'])->toBeNull()
        ->and($cards['score']['image'])->toBeNull()
        ->and($cards['share']['image'])->toBeNull()
        ->and(wrpShows($cards['build_spirit']['image'], $this->coverB))->toBeTrue();
})->with([
    'unchecked plate' => [fn ($t) => $t->coverA->forceFill(['plate_blur' => PlateBlurState::Unchecked])->save()],
    'now another member\'s' => [fn ($t) => $t->coverA->forceFill(['owner_id' => User::factory()->create()->id])->save()],
    'rejected' => [fn ($t) => $t->coverA->forceFill(['moderation_status' => ModerationStatus::Rejected])->save()],
    'deleted' => [fn ($t) => $t->coverA->delete()],
    'its car deleted' => [fn ($t) => $t->carA->delete()],
]);

it('never gives the spots or Treffen card a photo, even when the spotted car and the meet have one', function () {
    $other = User::factory()->create();
    $spotted = wrCar($other);
    $spotted->forceFill(['cover_media_id' => wrPhoto($spotted, $other)->id])->save();
    wrSpot($this->owner, $spotted);
    $event = wrEvent($this->owner, ['title' => 'Sommertreffen am Hafen']);
    wrPhoto($event, $other);

    $stored = wrpStored(wrpGenerate($this->owner));
    $cards = wrpRead($this->owner);

    expect($stored)->toHaveKeys(['spots', 'treffen'])
        ->and($stored['spots'])->not->toHaveKey('media_id')
        ->and($stored['treffen'])->not->toHaveKey('media_id')
        ->and($cards['spots'])->not->toHaveKey('image')
        ->and($cards['treffen'])->not->toHaveKey('image')
        ->and(json_encode([$cards['spots'], $cards['treffen']]))->not->toContain('"url"');
});

it('answers null for a Wrapped stored before the photos, until it is generated again', function () {
    $wrapped = wrpGenerate($this->owner);
    // As M5.9e stored it: only the share card had a media id.
    $wrapped->forceFill(['payload' => [...$wrapped->payload, 'cards' => array_map(function (array $card): array {
        if ($card['kind'] !== 'share') {
            unset($card['media_id']);
        }

        return $card;
    }, $wrapped->payload['cards'])]])->save();

    $cards = wrpRead($this->owner);

    expect($cards['intro']['image'])->toBeNull()
        ->and($cards['score']['image'])->toBeNull()
        ->and($cards['build_spirit']['image'])->toBeNull();

    wrpGenerate($this->owner);

    expect(wrpShows(wrpRead($this->owner)['intro']['image'], $this->coverA))->toBeTrue()
        ->and(wrpShows(wrpRead($this->owner)['share']['image'], $this->coverA))->toBeTrue();
});

it('draws the photo on the intro, score and spirit PNGs, from the public variants only', function (string $kind, string $cover) {
    wrpPaint($this->coverA, [20, 200, 60]);
    wrpPaint($this->coverB, [20, 200, 60]);
    $wrapped = wrpGenerate($this->owner);
    $n = wrpPosition($wrapped, $kind);
    $images = app(WrappedCardImages::class);

    $with = $images->png($wrapped, $n);
    // The same card as a row stored before ADR-516 a: no media id, so no photo.
    $wrapped->forceFill(['payload' => [...$wrapped->payload, 'cards' => array_map(function (array $card) use ($kind): array {
        if ($card['kind'] === $kind) {
            unset($card['media_id']);
        }

        return $card;
    }, $wrapped->payload['cards'])]])->save();
    $without = $images->png($wrapped->refresh(), $n);

    [$red, $green, $blue] = wrpPixel($with['png'], 540, 300);
    $canvas = DesignTokens::rgba('bg-canvas');

    expect($with['hash'])->not->toBe($without['hash'])
        ->and($with['png'])->not->toBe($without['png'])
        // The variant's green, never the private original's red.
        ->and($green)->toBeGreaterThan(150)
        ->and($red)->toBeLessThan(100)
        ->and($blue)->toBeLessThan(120)
        ->and(wrpPixel($without['png'], 540, 300))->toBe([$canvas[0], $canvas[1], $canvas[2]]);
})->with([
    'intro' => ['intro', 'coverA'],
    'score' => ['score', 'coverA'],
    'build spirit' => ['build_spirit', 'coverB'],
]);

it('draws no photo on the spots and Treffen PNGs', function () {
    $other = User::factory()->create();
    $spotted = wrCar($other);
    $foreign = wrPhoto($spotted, $other);
    $spotted->forceFill(['cover_media_id' => $foreign->id])->save();
    wrpPaint($foreign, [20, 200, 60]);
    wrSpot($this->owner, $spotted);
    wrEvent($this->owner);
    $wrapped = wrpGenerate($this->owner);
    $canvas = DesignTokens::rgba('bg-canvas');

    foreach (['spots', 'treffen'] as $kind) {
        $png = app(WrappedCardImages::class)->png($wrapped, wrpPosition($wrapped, $kind));

        expect(wrpPixel($png['png'], 540, 300))->toBe([$canvas[0], $canvas[1], $canvas[2]]);
    }
});

it('keeps another member\'s car out of the stored photos entirely', function () {
    $other = User::factory()->create();
    $spotted = wrCar($other);
    $foreign = wrPhoto($spotted, $other);
    $spotted->forceFill(['cover_media_id' => $foreign->id])->save();
    wrSpot($this->owner, $spotted);

    $stored = wrpGenerate($this->owner)->payload;

    expect(json_encode($stored))->not->toContain($foreign->id)
        ->and(Vehicle::query()->whereKey($spotted->id)->value('owner_id'))->toBe($other->id);
});

/** A blurhash of its own: the factory gives every photo the same one, and the same blurhash means the same picture. */
function wrpHash(): string
{
    return 'L'.Str::random(27);
}

/** @return array{intro: mixed, score: mixed, build_spirit: mixed, share: mixed} the stored media ids of the photo cards */
function wrpIds(User $member): array
{
    $stored = wrpStored(wrpGenerate($member));

    return ['intro' => $stored['intro']['media_id'], 'score' => $stored['score']['media_id'], 'build_spirit' => $stored['build_spirit']['media_id'], 'share' => $stored['share']['media_id']];
}

describe('cards about the same car (lead decision on ADR-516 a)', function () {
    beforeEach(function () {
        $this->solo = User::factory()->create();
        $this->car = wrCar($this->solo);
        foreach (range(1, 3) as $i) {
            wrMod($this->car, 'suspension', ['title' => "Fahrwerk $i"]);
        }
        wrScore($this->car, 520, ['2027-06-01' => 520]);
        $this->cover = wrPhoto($this->car, $this->solo, attributes: ['sort' => 9, 'blurhash' => wrpHash()]);
        $this->car->forceFill(['cover_media_id' => $this->cover->id])->save();
    });

    it('gives intro (and share), score and Build Spirit different photos of the car, the cover first, then by sort order', function () {
        $second = wrPhoto($this->car, $this->solo, attributes: ['sort' => 1, 'blurhash' => wrpHash()]);
        wrPhoto($this->car, $this->solo, PlateBlurState::Unchecked, ['sort' => 2, 'blurhash' => wrpHash()]);
        $third = wrPhoto($this->car, $this->solo, PlateBlurState::Declined, ['sort' => 3, 'blurhash' => wrpHash()]);
        wrPhoto($this->car, $this->solo, attributes: ['sort' => 4, 'blurhash' => wrpHash()]);

        expect(wrpIds($this->solo))->toBe(['intro' => $this->cover->id, 'score' => $second->id, 'build_spirit' => $third->id, 'share' => $this->cover->id]);

        $cards = wrpRead($this->solo);
        expect(wrpShows($cards['score']['image'], $second))->toBeTrue()
            ->and(wrpShows($cards['build_spirit']['image'], $third))->toBeTrue();
    });

    it('repeats the last photo only when the car has no further usable one', function () {
        $second = wrPhoto($this->car, $this->solo, attributes: ['sort' => 1, 'blurhash' => wrpHash()]);

        expect(wrpIds($this->solo))->toBe(['intro' => $this->cover->id, 'score' => $second->id, 'build_spirit' => $second->id, 'share' => $this->cover->id]);
    });

    it('repeats the one photo of a car that has only one', function () {
        expect(wrpIds($this->solo))->toBe(['intro' => $this->cover->id, 'score' => $this->cover->id, 'build_spirit' => $this->cover->id, 'share' => $this->cover->id]);
    });

    it('takes the car\'s mod photos after its gallery, never the one the top mod card shows', function () {
        $second = wrPhoto($this->car, $this->solo, attributes: ['sort' => 1, 'blurhash' => wrpHash()]);
        $modPhotos = collect(range(1, 2))->map(fn (int $i) => wrPhoto(wrMod($this->car, 'suspension', ['title' => "Gewindefahrwerk $i"]), $this->solo, attributes: ['blurhash' => wrpHash()]))->all();

        $stored = wrpStored(wrpGenerate($this->solo));
        $topMod = [$stored['top_mod']['before_media_id'] ?? null, $stored['top_mod']['after_media_id'] ?? null];
        $ids = [$stored['intro']['media_id'], $stored['score']['media_id'], $stored['build_spirit']['media_id']];

        expect(array_slice($ids, 0, 2))->toBe([$this->cover->id, $second->id])
            ->and($ids[2])->toBeIn(array_map(fn ($media) => $media->id, $modPhotos))
            ->and($ids[2])->not->toBeIn($topMod)
            ->and(array_unique($ids))->toHaveCount(3);
    });

    it('takes photos of installed mods only, never of a planned or removed part (review SF-2)', function () {
        $second = wrPhoto($this->car, $this->solo, attributes: ['sort' => 1, 'blurhash' => wrpHash()]);
        $planned = wrPhoto(wrMod($this->car, 'wheels_tires', ['title' => 'Felgen-Wunschliste', 'status' => ModStatus::Planned, 'installed_on' => null]), $this->solo, attributes: ['blurhash' => wrpHash()]);
        $removed = wrPhoto(wrMod($this->car, 'exhaust', ['title' => 'Alter Auspuff', 'status' => ModStatus::Removed]), $this->solo, attributes: ['blurhash' => wrpHash()]);

        $ids = array_values(wrpIds($this->solo));

        expect($ids)->not->toContain($planned->id)
            ->and($ids)->not->toContain($removed->id)
            ->and(wrpIds($this->solo)['build_spirit'])->toBe($second->id);
    });

    it('drops a mod photo on read when its mod or its car is gone, even if the photo row survived (review SF-1)', function (string $gone) {
        wrPhoto($this->car, $this->solo, attributes: ['sort' => 1, 'blurhash' => wrpHash()]);
        $mod = wrMod($this->car, 'suspension', ['title' => 'Gewindefahrwerk']);
        $photo = wrPhoto($mod, $this->solo, attributes: ['blurhash' => wrpHash()]);
        // A second installed mod with a photo, so the top mod card has one of its own and $photo goes to the Build Spirit card.
        $other = wrPhoto(wrMod($this->car, 'suspension', ['title' => 'Stabilisatoren']), $this->solo, attributes: ['blurhash' => wrpHash()]);
        $stored = wrpStored(wrpGenerate($this->solo));
        $spirit = $stored['build_spirit']['media_id'];
        expect($spirit)->toBeIn([$photo->id, $other->id]);

        $owner = Media::query()->findOrFail($spirit)->mediable;
        // The cleanup that would delete the photo rows did not run: only the parent goes.
        $gone === 'mod' ? $owner->delete() : $this->car->delete();

        expect(wrpRead($this->solo)['build_spirit']['image'] ?? null)->toBeNull();
    })->with(['mod', 'car']);

    it('skips the same picture uploaded again (same blurhash), so a repeat is a real repeat', function () {
        $second = wrPhoto($this->car, $this->solo, attributes: ['sort' => 1, 'blurhash' => wrpHash()]);
        // The demo's mod photos reuse the gallery shoot: same picture, another media id.
        wrPhoto(wrMod($this->car, 'suspension', ['title' => 'Domstrebe']), $this->solo, attributes: ['blurhash' => $this->cover->blurhash]);
        wrPhoto(wrMod($this->car, 'suspension', ['title' => 'Stabis']), $this->solo, attributes: ['blurhash' => $second->blurhash]);

        expect(wrpIds($this->solo))->toBe(['intro' => $this->cover->id, 'score' => $second->id, 'build_spirit' => $second->id, 'share' => $this->cover->id]);
    });

    it('never takes another of the member\'s cars to avoid a repeat', function () {
        $other = wrCar($this->solo);
        wrPhoto($other, $this->solo);

        expect(array_unique(array_values(wrpIds($this->solo))))->toBe([$this->cover->id]);
    });
});
