<?php

use App\Enums\BusinessStatus;
use App\Models\Brand;
use App\Models\Media;
use App\Models\ModBusinessTag;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\User;
use App\Services\PublicPages\PartnerOgImages;
use App\Services\PublicPages\SitemapWriter;

require_once __DIR__.'/../Businesses/BusinessTestHelpers.php';

/**
 * M4.14 WEB-14 /b/{slug} and WEB-15 /brands/{slug} (09 §9): server-rendered without JavaScript, behind their flags, the Impressum block
 * on every business page, the sample note, noindex for samples, JSON-LD, the portfolio and the brand's real counts.
 */
beforeEach(function () {
    bizFlags();
    $this->business = bizBusiness(User::factory()->create(), ['slug' => 'fahrwerkstatt-elbe', 'name' => 'Fahrwerkstatt Elbe', 'vat_id' => 'DE123456789', 'phone' => '+49 40 1234567']);
});

it('renders the business page with the Impressum block', function () {
    $html = $this->get('/b/fahrwerkstatt-elbe', ['Accept-Language' => 'de'])->assertOk()->assertSee('data-testid="WEB-14.root"', false)->getContent();

    expect($html)->toContain('Fahrwerkstatt Elbe')->toContain('Werkstatt · Hamburg')->toContain('Verifiziert')
        ->toContain('data-testid="WEB-14.impressum"')->toContain('HRB 00000')->toContain('DE123456789')->toContain('Amtsgericht Hamburg')
        ->toContain('"@type":"AutoRepair"')->toContain('data-testid="WEB-14.portfolioEmpty"')
        ->not->toContain('noindex');
});

it('shows no logo tile without a logo (DQ-1181)', function () {
    $html = (string) $this->get('/b/fahrwerkstatt-elbe')->assertOk()->getContent();

    expect($html)->not->toContain('data-testid="WEB-14.logo"');

    $logo = Media::factory()->forModel($this->business)->create(['owner_id' => $this->business->owner_id]);
    $this->business->forceFill(['logo_media_id' => $logo->id])->save();

    expect((string) $this->get('/b/fahrwerkstatt-elbe')->assertOk()->getContent())->toContain('data-testid="WEB-14.logo"');
});

it('never shows the hero photo again on the portfolio card below it, and shares the same cover (DQ-1215)', function () {
    $mod = bizBuildWithMod();
    $vehicle = $mod->vehicle;
    $first = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $vehicle->id)->firstOrFail();
    $first->forceFill(['sort' => 1])->save();
    $second = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id, 'sort' => 2]);
    $vehicle->forceFill(['cover_media_id' => $first->id])->save();
    $mod->forceFill(['installed_by_business_id' => $this->business->id])->saveQuietly();
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $this->business->id, 'status' => 'accepted']);
    bizRebuild($vehicle);

    $html = (string) $this->get('/b/fahrwerkstatt-elbe')->assertOk()->getContent();
    preg_match('~data-testid="WEB-14.cover".*?</div>~s', $html, $hero);
    preg_match('~<li class="sc-garage-item">.*?</li>~s', $html, $card);
    $variants = fn (Media $media): array => array_values(array_map(fn (string $path): string => implode('/', array_slice(explode('/', $path), -2)), (array) $media->variants));

    // The hero is the cover fallback (the build's cover); the card takes the build's next photo.
    expect($hero[0])->toContain($variants($first)[0])
        ->and($card[0])->not->toContain($variants($first)[0])->toContain($variants($second)[0])
        ->and(app(PartnerOgImages::class)->spec($this->business->refresh())['photo'])->toBe($first->id);
});

it('leads with the brand photo when the only portfolio build has one photo, on the page and the share card (DQ-1215)', function () {
    $mod = bizBuildWithMod();
    $photo = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $mod->vehicle_id)->firstOrFail();
    $mod->forceFill(['installed_by_business_id' => $this->business->id])->saveQuietly();
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $this->business->id, 'status' => 'accepted']);
    bizRebuild($mod->vehicle);
    $path = implode('/', array_slice(explode('/', (string) collect((array) $photo->variants)->first()), -2));

    $html = (string) $this->get('/b/fahrwerkstatt-elbe')->assertOk()->getContent();
    preg_match('~data-testid="WEB-14.cover".*?</div>~s', $html, $hero);
    preg_match('~<li class="sc-garage-item">.*?</li>~s', $html, $card);

    expect($hero[0])->not->toContain($path)->toContain('brand/')
        ->and($card[0])->toContain($path)
        ->and(app(PartnerOgImages::class)->spec($this->business->refresh())['photo'])->toBeNull();
});

it('shows the portfolio of confirmed builds and marks a sample business', function () {
    $mod = bizBuildWithMod();
    $mod->forceFill(['installed_by_business_id' => $this->business->id])->saveQuietly();
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $this->business->id, 'status' => 'accepted']);

    $this->get('/b/fahrwerkstatt-elbe')->assertOk()->assertSee('data-testid="WEB-14.build"', false);

    $this->business->forceFill(['is_sample' => true])->save();
    $this->get('/b/fahrwerkstatt-elbe')->assertOk()->assertSee('noindex', false)->assertSee('data-testid="WEB-14.impressumSample"', false);
});

it('answers the same 404 page when the flag is off or the business is not public', function (Closure $setup) {
    $setup($this->business);

    $this->get('/b/fahrwerkstatt-elbe')->assertNotFound()->assertSee('data-state="business_unavailable"', false);
})->with([
    'flag off' => [fn () => bizFlags(['businesses' => false])],
    'applied' => [fn ($b) => $b->forceFill(['status' => BusinessStatus::Applied])->save()],
    'suspended' => [fn ($b) => $b->forceFill(['status' => BusinessStatus::Suspended])->save()],
    'missing' => [fn ($b) => $b->delete()],
]);

it('renders the brand page with real counts, lines and products', function () {
    $brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw', 'about' => ['de' => 'Fahrwerkshersteller aus Fichtenberg.', 'en' => 'Suspension maker.']]);
    $product = Product::factory()->create(['brand_id' => $brand->id, 'category_id' => ModCategory::factory(), 'name' => 'Variante 3', 'line' => 'Gewindefahrwerke']);
    bizBuildWithMod(null, $product);

    $html = $this->get('/brands/kw', ['Accept-Language' => 'de'])->assertOk()->assertSee('data-testid="WEB-15.root"', false)->getContent();
    expect($html)->toContain('Fahrwerkshersteller aus Fichtenberg.')->toContain('Gewindefahrwerke')->toContain('Variante 3')
        ->toContain('In 1 Build')->toContain('data-testid="WEB-15.build"')->toContain('"@type":"Brand"');

    bizFlags(['parts_catalogue' => false]);
    $this->get('/brands/kw')->assertNotFound()->assertSee('data-state="brand_unavailable"', false);
    bizFlags();
    $this->get('/brands/gibt-es-nicht')->assertNotFound();
});

it('leads the brand page with a real build photo, thumbnails the parts and puts parts without a real build under "Weitere Teile" (DQ-1166/1167)', function () {
    $brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw']);
    $category = ModCategory::factory()->create();
    $used = Product::factory()->create(['brand_id' => $brand->id, 'category_id' => $category->id, 'name' => 'Variante 3']);
    Product::factory()->create(['brand_id' => $brand->id, 'category_id' => $category->id, 'name' => 'Clubsport']);
    bizBuildWithMod(null, $used);

    $html = (string) $this->get('/brands/kw', ['Accept-Language' => 'de'])->assertOk()->getContent();
    preg_match('~data-testid="WEB-15.products".*?</ul>~s', $html, $counted);
    preg_match('~data-testid="WEB-15.otherProducts".*?</ul>~s', $html, $others);

    expect($html)->toContain('data-testid="WEB-15.leadPhoto"')->toContain('data-testid="WEB-15.leadCredit"')
        // The lead photo is the page's LCP: the one high-priority image and its preload.
        ->and(substr_count($html, 'fetchpriority="high"'))->toBe(2)
        ->and($html)->toContain('data-testid="WEB-15.moreParts"')->toContain('Weitere Teile')
        ->and($counted[0])->toContain('Variante 3')->toContain('In 1 Build')->toContain('data-sc-src=')
        // DQ-1167: a part without a real build photo has no tile at all, never a glyph in a square.
        ->and($others[0])->toContain('Clubsport')->not->toContain('data-testid="WEB-15.productBuilds"')->not->toContain('WEB-15.productThumb')->not->toContain('<svg');
});

it('counts no sample build on the brand page and badges a sample lead photo (ADR-457)', function () {
    $brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw']);
    $product = Product::factory()->create(['brand_id' => $brand->id, 'category_id' => ModCategory::factory(), 'name' => 'Variante 3']);
    $mod = bizBuildWithMod(User::factory()->create(['is_sample' => true]), $product);
    $mod->vehicle->forceFill(['is_sample' => true])->save();
    bizRebuild($mod->vehicle);

    $html = (string) $this->get('/brands/kw', ['Accept-Language' => 'de'])->assertOk()->getContent();
    preg_match('~data-testid="WEB-15.counts">(.*?)</p>~s', $html, $counts);

    expect($counts[1])->not->toContain('Build')->toContain('Teil')
        ->and($html)->not->toContain('In 1 Build')
        ->and($html)->toContain('data-testid="WEB-15.leadSample"');
});

it('lists business and brand pages in the sitemap while their flags are on, never samples', function () {
    $brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw']);
    Product::factory()->create(['brand_id' => $brand->id, 'category_id' => ModCategory::factory()]);
    bizBusiness(null, ['slug' => 'beispiel-werkstatt-nord', 'is_sample' => true]);

    $xml = app(SitemapWriter::class)->render();
    expect($xml)->toContain('/b/fahrwerkstatt-elbe')->toContain('/brands/kw')->not->toContain('beispiel-werkstatt-nord');

    bizFlags(['businesses' => false, 'parts_catalogue' => false]);
    expect(app(SitemapWriter::class)->render())->not->toContain('/b/fahrwerkstatt-elbe')->not->toContain('/brands/kw');
});
