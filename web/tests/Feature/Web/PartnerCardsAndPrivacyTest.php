<?php

use App\Enums\MediaStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Brand;
use App\Models\Media;
use App\Models\ModBusinessTag;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';

/**
 * SEC-414 Lows of the public web (docs/reports/security/phase-4-m414-m417.md):
 * - 05: partner OG cards keep one pair per subject on disk, and draws are capped per owner and hour;
 * - 09: /b and /brands (indexed, in the sitemap) never show a build of a member who switched search engines off;
 * - 10: a member's cover taken from a vehicle that left the public garage is gone from the API and the og:image too, not only /u.
 */
beforeEach(function () {
    Storage::fake('public');
});

function ogCardAddress(string $html, string $type, string $slug): string
{
    preg_match('#/og/'.$type.'/('.preg_quote($slug, '#').'-[0-9a-f]{16})\.jpg#', $html, $match);
    expect($match)->not->toBeEmpty();

    return '/og/'.$type.'/'.$match[1].'.jpg';
}

it('keeps exactly one card pair of an event on disk however often its title changes', function () {
    evFlags();
    $event = evEvent(evOrganiser(), ['slug' => 'abendtreffen-am-hafen', 'title' => 'Abendtreffen am Hafen']);

    foreach (range(1, 5) as $round) {
        $event->forceFill(['title' => "Abendtreffen am Hafen $round"])->save();
        $this->get(ogCardAddress((string) $this->get('/e/abendtreffen-am-hafen')->getContent(), 'e', 'abendtreffen-am-hafen'))->assertOk();
    }

    expect(Storage::disk('public')->files('og/e'))->toHaveCount(2);
});

it('caps card draws per owner and hour, answering the brand card beyond it', function () {
    evFlags();
    config(['speedclub.public_pages.og_partner_draws_per_hour' => 2]);
    $event = evEvent(evOrganiser(), ['slug' => 'abendtreffen-am-hafen', 'title' => 'Treffen 0']);
    $default = (string) file_get_contents(public_path(config()->string('speedclub.public_pages.og_default')));

    foreach ([1, 2] as $round) {
        $event->forceFill(['title' => "Treffen $round"])->save();
        $card = $this->get(ogCardAddress((string) $this->get('/e/abendtreffen-am-hafen')->getContent(), 'e', 'abendtreffen-am-hafen'))->assertOk();
        expect($card->getContent())->not->toBe($default);
    }

    $event->forceFill(['title' => 'Treffen 3'])->save();
    $limited = $this->get(ogCardAddress((string) $this->get('/e/abendtreffen-am-hafen')->getContent(), 'e', 'abendtreffen-am-hafen'))->assertOk();

    expect($limited->getContent())->toBe($default)
        ->and($limited->headers->get('Cache-Control'))->not->toContain('immutable')
        ->and(Storage::disk('public')->files('og/e'))->toHaveCount(2);
});

it('leaves builds of members who switched search engines off out of /b and /brands', function () {
    bizFlags();
    $business = bizBusiness(User::factory()->create(), ['slug' => 'fahrwerkstatt-elbe']);
    $brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw']);
    $product = Product::factory()->create(['brand_id' => $brand->id, 'category_id' => ModCategory::factory(), 'name' => 'Variante 3']);
    $hidden = bizBuildWithMod(User::factory()->create(['indexable' => false]), $product);
    $shown = bizBuildWithMod(User::factory()->create(['indexable' => true]), $product);

    foreach ([$hidden, $shown] as $mod) {
        $mod->forceFill(['installed_by_business_id' => $business->id])->saveQuietly();
        ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $business->id, 'status' => 'accepted']);
    }

    $hiddenPath = '/v/'.$hidden->vehicle->canonicalSlug();
    $shownPath = '/v/'.$shown->vehicle->canonicalSlug();

    $page = (string) $this->get('/b/fahrwerkstatt-elbe')->assertOk()->getContent();
    expect($page)->toContain($shownPath)->not->toContain($hiddenPath);

    $brandPage = (string) $this->get('/brands/kw')->assertOk()->getContent();
    expect($brandPage)->toContain($shownPath)->not->toContain($hiddenPath);

    // The app's own portfolio (a signed-in reader, not an indexed page) is unchanged.
    $this->getJson('/api/v1/businesses/fahrwerkstatt-elbe/portfolio')->assertJsonCount(2, 'data');
});

it('drops a cover from a vehicle that went private from the member API and the og:image', function () {
    Queue::fake();
    $member = User::factory()->create(['username' => 'lena.911']);
    $vehicle = publishedVehicle($member);
    $photo = Media::query()->where('mediable_id', $vehicle->id)->firstOrFail();
    expect($photo->status)->toBe(MediaStatus::Ready);
    $member->forceFill(['cover_media_id' => $photo->id])->save();

    $this->getJson('/api/v1/public/users/lena.911')->assertOk()->assertJsonPath('data.cover.id', $photo->id);
    $before = app(OgImages::class)->cards($member->fresh(OgImages::MEMBER_RELATIONS));

    Vehicle::query()->whereKey($vehicle->id)->update(['visibility' => Visibility::Private->value]);

    $this->getJson('/api/v1/public/users/lena.911')->assertOk()->assertJsonPath('data.cover', null);
    expect(app(OgImages::class)->cards($member->fresh(OgImages::MEMBER_RELATIONS)))->not->toBe($before);

    // The member still sees their own cover.
    Sanctum::actingAs($member);
    $this->getJson('/api/v1/public/users/lena.911')->assertOk()->assertJsonPath('data.cover.id', $photo->id);

    // Back in the public garage, it shows again.
    Vehicle::query()->whereKey($vehicle->id)->update(['visibility' => Visibility::Public->value, 'status' => VehicleStatus::Published->value]);
    app('auth')->forgetGuards();
    $this->getJson('/api/v1/public/users/lena.911')->assertOk()->assertJsonPath('data.cover.id', $photo->id);
});
