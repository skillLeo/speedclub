<?php

use App\Models\Brand;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdates;
use Illuminate\Support\Facades\Storage;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';
require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';

/**
 * M4.16 Public web 2.0 (09 §9): the landing page (since R4-1.5 without the editorial grid and teasers), WEB-02 as PROF-02 with VehicleCards 2.0, one filled CTA
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
    // R4-1.5 (client round 4): the editorial grid, the meets and the workshop teaser of M4.16 left the landing page; their components stay.
    it('features no builds, meets or workshop teaser any more, whatever the flags', function () {
        $nina = User::factory()->create(['username' => 'nina.neu']);
        publishedVehicle($nina, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'BMW', 'model_text' => 'M3']);
        evFlags();
        bizFlags();
        evEvent(evOrganiser(), ['title' => 'Treffen Tag 1', 'starts_at' => now()->addDay()->setTime(18, 0), 'ends_at' => now()->addDay()->setTime(21, 0)]);

        $html = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect($html)->not->toContain('data-testid="WEB-03.featuredLink"')->not->toContain('data-testid="WEB-03.build"')
            ->not->toContain('BMW M3')->not->toContain('Treffen Tag 1')->not->toContain('data-testid="WEB-03.events"')
            ->not->toContain('data-testid="WEB-03.business"')->not->toContain('Für Werkstätten');
    });

    it('starts the claim at the text-safe line and keeps one filled CTA in English too', function () {
        $html = $this->get('/?lang=en')->assertOk()->getContent();

        expect($html)->toContain("Your\u{00A0}car. Your\u{00A0}build. Your\u{00A0}club.")->toContain('Get the app')->toContain('<div class="sc-land-hero-inner">')
            ->and(pw2Filled($html))->toBe(1);
    });
});

describe('WEB-01 Verlauf', function () {
    it('titles a note with its first line, never "Notiz" (DQ-1178)', function () {
        app(BuildUpdates::class)->note($this->vehicle, "Neue Felgen montiert.\nBilder folgen am Wochenende.");

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();
        preg_match('~data-testid="WEB-01.update">(.*?)</li>~s', $html, $entry);

        expect($entry[1])->toMatch('~<p class="text-body-strong text-ink">Neue Felgen montiert.</p>~')
            ->toContain('Bilder folgen am Wochenende.')
            ->not->toContain('Notiz')
            ->and(substr_count($entry[1], 'Neue Felgen montiert.'))->toBe(1);
    });

    it('lets the section tabs wrap instead of clipping them at a large font (DQ-1179)', function () {
        expect((string) file_get_contents(resource_path('css/public.css')))->toMatch('~\.sc-tabs-row \{[^}]*flex-wrap: wrap;~');
    });
});

describe('WEB-02', function () {
    it('shows PROF-02: title.1 name, quiet meta line, Folgen as the only filled CTA and the garage as VehicleCards 2.0', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get('/u/lukas.sc')->assertOk()->getContent();

        expect($html)->toMatch('~class="mt-12 t-title-1 text-ink" data-testid="WEB-02.name"~')
            ->toContain('data-testid="WEB-02.vehicle.title"')
            // DQ-1175: the meta is WEB-01's sub-line (year, engine), never the name again; the mini spec has its label above the numeral.
            ->toMatch('~data-testid="WEB-02.vehicle.meta">2002(?: · |</span>)~')->not->toContain('Nissan · Skyline')
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

describe('WEB-14 and WEB-15 cards', function () {
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
