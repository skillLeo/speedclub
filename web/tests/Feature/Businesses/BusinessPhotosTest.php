<?php

use App\Enums\ModTagStatus;
use App\Models\Business;
use App\Models\Media;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BusinessTestHelpers.php';

/**
 * ADR-457 / DQ-1139 / DQ-1140 / DQ-1144: the BusinessCard `cover` with its fallback chain (own cover → newest portfolio build photo →
 * null), real businesses before samples, no "Verifiziert" on a sample, portfolio counts of real builds only and the portfolio wall with
 * real builds first.
 */
beforeEach(function () {
    bizFlags();
});

/** "Eingebaut von", confirmed by both sides. */
function photoTagAccepted(Modification $mod, Business $business): void
{
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $business->id, 'status' => ModTagStatus::Accepted]);
    $mod->forceFill(['installed_by_business_id' => $business->id])->saveQuietly();
    bizRebuild($mod->vehicle);
}

function photoSampleVehicle(Modification $mod): void
{
    Vehicle::query()->whereKey($mod->vehicle_id)->update(['is_sample' => true]);
    bizRebuild($mod->vehicle);
}

it('gives a card its own cover, else the newest portfolio build photo, else null', function () {
    $own = bizBusiness(null, ['slug' => 'mit-cover', 'name' => 'A Mit Cover']);
    $cover = Media::factory()->forModel($own)->create(['owner_id' => $own->owner_id]);
    $own->forceFill(['cover_media_id' => $cover->id])->save();

    $portfolio = bizBusiness(null, ['slug' => 'mit-portfolio', 'name' => 'B Mit Portfolio']);
    $mod = bizBuildWithMod();
    photoTagAccepted($mod, $portfolio);
    $buildPhoto = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $mod->vehicle_id)->value('id');

    // Pending only: not in the portfolio, so no fallback.
    $none = bizBusiness(null, ['slug' => 'ohne-alles', 'name' => 'C Ohne Alles']);
    ModBusinessTag::factory()->create(['mod_id' => bizBuildWithMod()->id, 'business_id' => $none->id, 'status' => ModTagStatus::Pending]);

    $this->getJson('/api/v1/businesses')->assertOk()
        ->assertJsonPath('data.0.cover.id', $cover->id)->assertJsonPath('data.0.cover_source', 'business')
        ->assertJsonPath('data.1.cover.id', $buildPhoto)->assertJsonPath('data.1.cover_source', 'portfolio')
        ->assertJsonPath('data.2.cover', null)->assertJsonPath('data.2.cover_source', null);

    // DQ-1215: the detail (BIZ-01) leads with heroCover(): this build has one photo, which its portfolio card shows, so no hero photo.
    $this->getJson('/api/v1/businesses/mit-portfolio')->assertOk()->assertJsonPath('data.cover', null)->assertJsonPath('data.cover_source', null);
    $this->getJson('/api/v1/businesses/mit-cover')->assertOk()->assertJsonPath('data.cover.id', $cover->id)->assertJsonPath('data.cover_source', 'business');
});

describe('DQ-1215 BIZ-01 hero (as WEB-14, PartnerPagesTest)', function () {
    it('leads with the build photo when the build has a second photo for its portfolio card', function () {
        $business = bizBusiness(null, ['slug' => 'zwei-fotos']);
        $mod = bizBuildWithMod();
        $vehicle = $mod->vehicle;
        $first = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $vehicle->id)->firstOrFail();
        $first->forceFill(['sort' => 1])->save();
        $second = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id, 'sort' => 2]);
        $vehicle->forceFill(['cover_media_id' => $first->id])->save();
        photoTagAccepted($mod, $business);

        $this->getJson('/api/v1/businesses/zwei-fotos')->assertOk()
            ->assertJsonPath('data.cover.id', $first->id)->assertJsonPath('data.cover_source', 'portfolio');
        // The portfolio still lists the build with its cover: the app's card takes the next photo (heroPhotoId), never the hero's.
        $this->getJson('/api/v1/businesses/zwei-fotos/portfolio')->assertOk()->assertJsonPath('data.0.cover.id', $first->id);
        expect($second->id)->not->toBe($first->id);
    });

    it('sends no cover when the only portfolio build has one photo, while its list card keeps the fallback', function () {
        $business = bizBusiness(null, ['slug' => 'ein-foto', 'name' => 'Ein Foto']);
        $mod = bizBuildWithMod();
        photoTagAccepted($mod, $business);
        $photo = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $mod->vehicle_id)->sole();

        $this->getJson('/api/v1/businesses/ein-foto')->assertOk()->assertJsonPath('data.cover', null)->assertJsonPath('data.cover_source', null);
        $this->getJson('/api/v1/businesses/ein-foto/portfolio')->assertOk()->assertJsonPath('data.0.cover.id', $photo->id);
        $this->getJson('/api/v1/businesses')->assertOk()->assertJsonPath('data.0.cover.id', $photo->id)->assertJsonPath('data.0.cover_source', 'portfolio');
    });

    it('keeps the business\'s own cover as the hero', function () {
        $business = bizBusiness(null, ['slug' => 'eigenes-cover']);
        $cover = Media::factory()->forModel($business)->create(['owner_id' => $business->owner_id]);
        $business->forceFill(['cover_media_id' => $cover->id])->save();
        photoTagAccepted(bizBuildWithMod(), $business);

        $this->getJson('/api/v1/businesses/eigenes-cover')->assertOk()->assertJsonPath('data.cover.id', $cover->id)->assertJsonPath('data.cover_source', 'business');
    });
});

it('prefers a real portfolio build over a newer sample one for the fallback cover', function () {
    $business = bizBusiness(null, ['slug' => 'werkstatt']);
    $real = bizBuildWithMod();
    photoTagAccepted($real, $business);
    $sample = bizBuildWithMod();
    photoTagAccepted($sample, $business);
    photoSampleVehicle($sample);
    Vehicle::query()->whereKey($sample->vehicle_id)->update(['updated_at' => now()->addHour()]);
    bizRebuild($sample->vehicle);

    $realPhoto = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $real->vehicle_id)->value('id');
    // The list card's fallback chain.
    $this->getJson('/api/v1/businesses')->assertOk()->assertJsonPath('data.0.cover.id', $realPhoto)->assertJsonPath('data.0.cover_source', 'portfolio');
    // The detail's hero takes it too once the real build has a second photo for its portfolio card (DQ-1215).
    Media::factory()->forModel($real->vehicle)->create(['owner_id' => $real->vehicle->owner_id, 'sort' => 99]);
    $this->getJson('/api/v1/businesses/werkstatt')->assertOk()->assertJsonPath('data.cover.id', $realPhoto)
        ->assertJsonPath('data.portfolio_count', 1);
    $this->getJson('/api/v1/businesses/werkstatt/portfolio')->assertOk()
        ->assertJsonPath('data.0.id', $real->vehicle_id)->assertJsonPath('data.1.id', $sample->vehicle_id)->assertJsonPath('data.1.is_sample', true);
});

it('never shows Verifiziert on a sample business, and lists real businesses before samples', function () {
    $sampleOwner = User::factory()->create(['is_sample' => true]);
    bizBusiness($sampleOwner, ['slug' => 'aaa-beispiel', 'name' => 'AAA Beispiel-Werkstatt', 'is_sample' => true]);
    bizBusiness(null, ['slug' => 'zzz-echt', 'name' => 'ZZZ Echte Werkstatt']);

    $this->getJson('/api/v1/businesses')->assertOk()
        ->assertJsonPath('data.0.slug', 'zzz-echt')->assertJsonPath('data.0.verified', true)
        ->assertJsonPath('data.1.slug', 'aaa-beispiel')->assertJsonPath('data.1.verified', false)->assertJsonPath('data.1.is_sample', true);
    $this->getJson('/api/v1/businesses/aaa-beispiel')->assertOk()->assertJsonPath('data.verified', false);
    $first = $this->getJson('/api/v1/businesses?per_page=1')->assertJsonPath('data.0.slug', 'zzz-echt');
    $this->getJson('/api/v1/businesses?per_page=1&cursor='.$first->json('meta.next_cursor'))->assertJsonPath('data.0.slug', 'aaa-beispiel');

    // The Blade page carries no badge either.
    $this->get('/b/aaa-beispiel')->assertOk()->assertDontSee('data-testid="WEB-14.verified"', false);
});

it('names the installer on the public Mods tab only after both sides confirmed, never verified on a sample business', function (string $as) {
    $member = User::factory()->create();
    $mod = bizBuildWithMod($member);
    $business = bizBusiness(null, ['slug' => 'fahrwerk-elbe', 'name' => 'Fahrwerk Elbe']);
    $tag = ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $business->id, 'status' => ModTagStatus::Pending]);
    $vehicle = $mod->vehicle;

    match ($as) {
        'owner' => Sanctum::actingAs($member),
        'member' => Sanctum::actingAs(User::factory()->create()),
        default => null,
    };

    $path = '/api/v1/public/vehicles/'.$vehicle->canonicalSlug();
    $this->getJson($path)->assertOk()->assertJsonPath('data.mods.groups.0.items.0.installed_by', null);

    $tag->forceFill(['status' => ModTagStatus::Accepted])->save();
    $mod->forceFill(['installed_by_business_id' => $business->id])->saveQuietly();
    $this->getJson($path)->assertOk()->assertJsonPath('data.mods.groups.0.items.0.installed_by', ['slug' => 'fahrwerk-elbe', 'name' => 'Fahrwerk Elbe', 'city' => $business->city, 'verified' => true]);

    $business->forceFill(['is_sample' => true])->save();
    $this->getJson($path)->assertOk()->assertJsonPath('data.mods.groups.0.items.0.installed_by.verified', false);
})->with(['guest', 'owner', 'member']);
