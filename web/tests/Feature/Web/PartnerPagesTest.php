<?php

use App\Enums\BusinessStatus;
use App\Models\Brand;
use App\Models\ModBusinessTag;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\User;
use App\Services\PublicPages\SitemapWriter;

require_once __DIR__.'/../Businesses/BusinessTestHelpers.php';

/**
 * M4.14 WEB-10 /b/{slug} and WEB-11 /brands/{slug} (09 §9): server-rendered without JavaScript, behind their flags, the Impressum block
 * on every business page, the sample note, noindex for samples, JSON-LD, the portfolio and the brand's real counts.
 */
beforeEach(function () {
    bizFlags();
    $this->business = bizBusiness(User::factory()->create(), ['slug' => 'fahrwerkstatt-elbe', 'name' => 'Fahrwerkstatt Elbe', 'vat_id' => 'DE123456789', 'phone' => '+49 40 1234567']);
});

it('renders the business page with the Impressum block', function () {
    $html = $this->get('/b/fahrwerkstatt-elbe', ['Accept-Language' => 'de'])->assertOk()->assertSee('data-testid="WEB-10.root"', false)->getContent();

    expect($html)->toContain('Fahrwerkstatt Elbe')->toContain('Werkstatt · Hamburg')->toContain('Verifiziert')
        ->toContain('data-testid="WEB-10.impressum"')->toContain('HRB 00000')->toContain('DE123456789')->toContain('Amtsgericht Hamburg')
        ->toContain('"@type":"AutoRepair"')->toContain('data-testid="WEB-10.portfolioEmpty"')
        ->not->toContain('noindex');
});

it('shows the portfolio of confirmed builds and marks a sample business', function () {
    $mod = bizBuildWithMod();
    $mod->forceFill(['installed_by_business_id' => $this->business->id])->saveQuietly();
    ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $this->business->id, 'status' => 'accepted']);

    $this->get('/b/fahrwerkstatt-elbe')->assertOk()->assertSee('data-testid="WEB-10.build"', false);

    $this->business->forceFill(['is_sample' => true])->save();
    $this->get('/b/fahrwerkstatt-elbe')->assertOk()->assertSee('noindex', false)->assertSee('data-testid="WEB-10.impressumSample"', false);
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

    $html = $this->get('/brands/kw', ['Accept-Language' => 'de'])->assertOk()->assertSee('data-testid="WEB-11.root"', false)->getContent();
    expect($html)->toContain('Fahrwerkshersteller aus Fichtenberg.')->toContain('Gewindefahrwerke')->toContain('Variante 3')
        ->toContain('In 1 Build')->toContain('data-testid="WEB-11.build"')->toContain('"@type":"Brand"');

    bizFlags(['parts_catalogue' => false]);
    $this->get('/brands/kw')->assertNotFound()->assertSee('data-state="brand_unavailable"', false);
    bizFlags();
    $this->get('/brands/gibt-es-nicht')->assertNotFound();
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
