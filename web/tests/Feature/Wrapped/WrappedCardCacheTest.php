<?php

use App\Actions\Media\DeleteMedia;
use App\Actions\Media\KeepPlateCheckPhoto;
use App\Enums\PlateBlurState;
use App\Models\User;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedCardImages;
use App\Services\Wrapped\WrappedGenerator;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/WrappedTestHelpers.php';

/**
 * SEC-P5G-09: cached Wrapped card PNGs never keep a photo state that is gone (ADR-509, data minimisation): a new drawing of a card
 * replaces the older file, and a deleted photo or a new plate decision drops the member's cached cards at once.
 */
beforeEach(function () {
    wrFlags();
    wrRelease();
    $this->travelTo(wrNow());
    $this->disk = Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->owner = User::factory()->create();
    $this->car = wrCar($this->owner);
    $this->mod = wrMod($this->car, 'wheels_tires');
    $this->photo = wrPhoto($this->mod, $this->owner);
    $this->wrapped = app(WrappedGenerator::class)->generate($this->owner, Season::from(WR_SEASON));
    $this->topMod = array_search('top_mod', array_column($this->wrapped->cards(), 'kind'), true) + 1;
});

function wrcFiles(): array
{
    return test()->disk->allFiles('wrapped');
}

it('keeps one file per card and language: a new drawing replaces the older one', function () {
    app(WrappedCardImages::class)->png($this->wrapped, $this->topMod);
    $first = wrcFiles();
    expect($first)->toHaveCount(1)->and(basename($first[0]))->toStartWith($this->topMod.'-de-');

    // The photo was pixelated since: a new picture under the same id.
    $this->photo->forceFill(['blurred_at' => now()])->save();
    app(WrappedCardImages::class)->png($this->wrapped->refresh(), $this->topMod);

    expect(wrcFiles())->toHaveCount(1)->and(wrcFiles())->not->toBe($first);

    app()->setLocale('en');
    app(WrappedCardImages::class)->png($this->wrapped, $this->topMod);
    expect(wrcFiles())->toHaveCount(2);
});

it('drops the member\'s cached cards when a photo is deleted', function () {
    app(WrappedCardImages::class)->png($this->wrapped, $this->topMod);
    app(WrappedCardImages::class)->png($this->wrapped, 1);
    expect(wrcFiles())->toHaveCount(2);

    app(DeleteMedia::class)->handle($this->photo);

    expect(wrcFiles())->toBe([]);
});

it('drops the member\'s cached cards when a photo gets its plate decision, and only then', function () {
    $unchecked = wrPhoto($this->car, $this->owner, PlateBlurState::Unchecked);
    app(WrappedCardImages::class)->png($this->wrapped, 1);

    app(KeepPlateCheckPhoto::class)->handle($this->photo); // already decided: nothing changes
    expect(wrcFiles())->toHaveCount(1);

    app(KeepPlateCheckPhoto::class)->handle($unchecked);
    expect(wrcFiles())->toBe([]);
});
