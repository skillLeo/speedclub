<?php

use App\Models\Brand;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\Storage;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';
require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';

/**
 * M4.16 Public web 2.0 (09 §9): the landing page's editorial grid and teasers, WEB-02 as PROF-02 with VehicleCards 2.0, one filled CTA
 * per page, and the drawn OG cards of the business and brand pages.
 */
beforeEach(function () {
    Storage::fake('public');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz', 'city' => 'Stuttgart']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R', 'model_year' => 2002]);
});

/** Counts the filled CTAs of a page: the accent fill and the inverse fill (09 §4 one filled CTA). */
function pw2Filled(string $html): int
{
    return preg_match_all('~(?<![:\w-])bg-(?:accent-fill|inverse)(?![\w-])~', $html);
}

describe('WEB-03', function () {
    it('lays the featured builds out as one lead and up to two cards, one build per owner first', function () {
        $nina = User::factory()->create(['username' => 'nina.neu']);
        $max = User::factory()->create(['username' => 'max.e46']);
        publishedVehicle($nina, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'BMW', 'model_text' => 'M3']);
        publishedVehicle($max, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Honda', 'model_text' => 'S2000']);
        publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Silvia']);

        $html = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect($html)->toContain('data-testid="WEB-03.featuredLink"')->toContain('Builds aus dem Club')
            ->and(substr_count($html, 'data-testid="WEB-03.build"'))->toBe(2)
            ->and($html)->toContain('BMW M3')->toContain('Honda S2000')->not->toContain('Nissan Silvia');
    });

    it('teases the next three public meets while events are on, with real dates, and none while off', function () {
        evFlags();
        $organiser = evOrganiser();
        foreach ([1, 2, 3, 4] as $day) {
            evEvent($organiser, ['title' => 'Treffen Tag '.$day, 'starts_at' => now()->addDays($day)->setTime(18, 0), 'ends_at' => now()->addDays($day)->setTime(21, 0)]);
        }
        evEvent($organiser, ['title' => 'Nur für Follower', 'visibility' => 'followers', 'starts_at' => now()->addHours(5), 'ends_at' => now()->addHours(8)]);

        $html = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();
        expect($html)->toContain('Nächste Treffen')->toContain('Treffen Tag 1')->toContain('Treffen Tag 3')->not->toContain('Treffen Tag 4')
            ->not->toContain('Nur für Follower')->and(substr_count($html, 'data-testid="WEB-03.event"'))->toBe(3);

        evFlags(['events' => false]);
        expect($this->get('/')->getContent())->not->toContain('data-testid="WEB-03.events"');
    });

    it('shows the workshop teaser only while businesses are on', function () {
        bizFlags(['businesses' => false]);
        expect($this->get('/')->getContent())->not->toContain('data-testid="WEB-03.business"');

        bizFlags();
        expect($this->withHeader('Accept-Language', 'de')->get('/')->getContent())->toContain('data-testid="WEB-03.business"')->toContain('Für Werkstätten');
    });

    it('starts the claim at the text-safe line and keeps one filled CTA in English too', function () {
        $html = $this->get('/?lang=en')->assertOk()->getContent();

        expect($html)->toContain('Your car. Your build. Your club.')->toContain('How the QR code works')->toContain('<div class="sc-land-hero-inner">')
            ->and(pw2Filled($html))->toBe(1);
    });
});

describe('WEB-02', function () {
    it('shows PROF-02: title.1 name, quiet meta line, Folgen as the only filled CTA and the garage as VehicleCards 2.0', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get('/u/lukas.sc')->assertOk()->getContent();

        expect($html)->toMatch('~class="mt-12 t-title-1 text-ink" data-testid="WEB-02.name"~')
            ->toContain('data-testid="WEB-02.vehicle.title"')->toContain('data-testid="WEB-02.vehicle.spec"')->toContain(' · 2002</span>')
            ->toContain('aspect-[4/5] rounded-xl')
            ->and(pw2Filled($html))->toBe(1)
            ->and($html)->toMatch('~bg-inverse text-ink-inverse[^>]*data-testid="WEB-02.follow"~');
    });

    it('overlaps a cover with the avatar 88', function () {
        $cover = Media::factory()->forModel($this->owner)->create(['owner_id' => $this->owner->id]);
        $this->owner->forceFill(['cover_media_id' => $cover->id])->save();

        expect($this->get('/u/lukas.sc')->getContent())->toContain('sc-prof is-covered')->toContain('h-88 w-88');
    });
});

describe('WEB-01', function () {
    it('keeps Folgen the one filled CTA: "In der App öffnen" and "Kostenlos beitreten" are secondary beside it (DQ-919)', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect(pw2Filled($html))->toBe(1)->and($html)->toContain('Kostenlos beitreten')->toContain('In der App öffnen');
    });
});

describe('WEB-10 and WEB-11 cards', function () {
    it('draws the business and brand cards and names them in og:image while their flags are on', function () {
        bizFlags();
        bizBusiness(User::factory()->create(), ['slug' => 'fahrwerkstatt-elbe', 'name' => 'Fahrwerkstatt Elbe']);
        $brand = Brand::query()->where('slug', 'kw')->first() ?? Brand::factory()->create(['name' => 'KW', 'slug' => 'kw']);
        Product::factory()->create(['brand_id' => $brand->id, 'category_id' => ModCategory::factory()]);

        foreach (['/b/fahrwerkstatt-elbe' => 'b/fahrwerkstatt-elbe', '/brands/kw' => 'brands/kw'] as $page => $card) {
            $html = $this->get($page)->assertOk()->getContent();
            preg_match('~og:image" content="[^"]*/og/'.preg_quote($card, '~').'-([0-9a-f]{16})\.jpg"~', $html, $match);
            expect($match)->not->toBeEmpty();

            $image = $this->get('/og/'.$card.'-'.$match[1].'.jpg')->assertOk()->assertHeader('Content-Type', 'image/jpeg');
            expect(getimagesizefromstring((string) $image->getContent())[0])->toBe(1200);
        }

        bizFlags(['businesses' => false, 'parts_catalogue' => false]);
        $this->get('/og/b/fahrwerkstatt-elbe-0000000000000000.jpg')->assertNotFound();
        $this->get('/og/brands/kw-0000000000000000.jpg')->assertNotFound();
    });

    it('answers 404 for a card address of a type or name that does not exist', function () {
        $this->get('/og/x/kw-0000000000000000.jpg')->assertNotFound();
        $this->get('/og/e/gibt-es-nicht-0000000000000000.jpg')->assertNotFound();
        expect(Vehicle::query()->count())->toBe(1);
    });
});
