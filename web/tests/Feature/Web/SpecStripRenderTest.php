<?php

use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\User;
use App\Models\VehicleSpec;
use App\Support\SpecStripLayout;
use Illuminate\Support\Facades\Blade;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * DQ-801 on WEB-01 and WEB-03: the strip carries the class of its breakpoints, and their container queries reach the page once,
 * inside the nonced style block (no style attributes under the CSP).
 */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R', 'model_year' => 2002]);
    $specs = new VehicleSpec(['vehicle_id' => $this->vehicle->id, 'torque_nm' => 540, 'torque_source' => 'factory', 'drivetrain' => 'all']);
    $specs->setPower(500, PowerUnit::Ps, PowerSource::Factory)->save();
    // SpecStrip 2.0: power and torque by name, their units beside the numerals, the factory source as provenance.
    $this->items = SpecStripLayout::items([
        ['value' => '500', 'unit' => 'PS', 'label' => 'Leistung', 'provenance' => 'Herstellerangabe'],
        ['value' => '540', 'unit' => 'Nm', 'label' => 'Drehmoment', 'provenance' => 'Herstellerangabe'],
        ['value' => '2002', 'label' => 'Baujahr'],
        ['value' => 'AWD', 'label' => 'Antrieb'],
    ]);
});

/**
 * @return list<array{nonce: string, css: string}>
 */
function noncedStyles(string $html): array
{
    preg_match_all('~<style nonce="([^"]+)">(.*?)</style>~s', $html, $matches, PREG_SET_ORDER);

    return array_map(fn (array $match): array => ['nonce' => $match[1], 'css' => $match[2]], $matches);
}

it('gives the R34 on WEB-01 its breakpoints once, inside the nonced style block', function () {
    $response = $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk();
    $html = (string) $response->getContent();
    preg_match("~style-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'~", (string) $response->headers->get('Content-Security-Policy'), $nonce);
    $class = SpecStripLayout::className($this->items);
    $css = SpecStripLayout::css($this->items, $class);
    $blocks = array_values(array_filter(noncedStyles($html), fn (array $block): bool => str_contains($block['css'], '.'.$class.' .sc-strip{')));

    // DQ-1047 (8/4 grid): the strip follows the identity block without a margin class of its own; any spacing class may follow.
    expect($html)->toMatch('~<div class="sc-strip-box text-body '.$class.'(?: [^"]*)?">\s*<ul class="sc-strip" data-testid="VEH-01.specStrip">~')
        ->and($blocks)->toHaveCount(1)
        ->and(substr_count($html, $css))->toBe(1)
        ->and($blocks[0]['nonce'])->toBe($nonce[1] ?? null)
        ->and($blocks[0]['css'])->toContain($css)
        // The thresholds of FS-3's R34 (ADR-431 b): hero.numeral on the page, 587 and 293 of 15 px body text; hero.numeral.s in
        // the desktop card, where "Herstellerangabe" leads, 519 and 259 of 16 px from 1280; 469 and 469 at scale 2.
        ->and($css)->toContain('@media (max-width: 1279.98px){@container sc-strip (width < 39.1334em)')
        ->and($css)->toContain('@container sc-strip (width < 19.5334em)')
        ->and($css)->toContain('@media (min-width: 1280px){@container sc-strip (width < 32.4375em)')
        ->and($css)->toContain('@container sc-strip (width < 16.1875em)')
        ->and($css)->toContain('@container sc-strip (width < 15.6334em){:root[data-qa-font-scale="2"]')
        ->and($css)->toContain('@container sc-strip (width < 14.6563em){:root[data-qa-font-scale="2"]')
        // The 2.0 cell: data label, numeral with unit, provenance, in the app's order.
        ->and($html)->toMatch('~<li class="sc-strip-cell" data-spec="power">\s*<span class="t-label-caps text-ink-2">Leistung</span>\s*<span class="sc-strip-value">\s*<span class="sc-strip-numeral text-ink">500</span>\s*<span class="t-label-unit text-ink-2">PS</span>\s*</span>\s*<span class="t-caption text-ink-3">Herstellerangabe</span>~')
        ->and($html)->toMatch('~<li class="sc-strip-cell" data-spec="model_year">\s*<span class="t-label-caps text-ink-2">Baujahr</span>\s*<span class="sc-strip-value">\s*<span class="sc-strip-numeral text-ink">2002</span>\s*</span>\s*</li>~')
        // Unescaped, so the browser reads "<" and the quotes.
        ->and($blocks[0]['css'])->not->toContain('&lt;')
        ->and($blocks[0]['css'])->not->toContain('&quot;');
});

it('gives the featured strip of WEB-03 the same rule', function () {
    $html = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();
    $class = SpecStripLayout::className($this->items);

    expect($html)->toContain('data-testid="WEB-03.featuredStrip"')
        ->and($html)->toMatch('~<div class="sc-strip-box text-body '.$class.'">\s*<ul class="sc-strip" data-testid="WEB-03.featuredStrip">~')
        ->and(substr_count($html, SpecStripLayout::css($this->items, $class)))->toBe(1);
});

it('pushes the CSS once for two strips with the same breakpoints, and once more for different ones', function () {
    $other = [['key' => 'power', 'value' => '1.020', 'unit' => 'PS', 'label' => 'PS'], ['key' => 'torque', 'value' => '540', 'unit' => 'Nm', 'label' => 'Nm']];
    $strip = [
        ['key' => 'power', 'value' => '500', 'unit' => 'PS', 'label' => 'PS'],
        ['key' => 'torque', 'value' => '540', 'unit' => 'Nm', 'label' => 'Nm'],
        ['key' => 'model_year', 'value' => '2002', 'unit' => null, 'label' => 'Baujahr'],
        ['key' => 'drivetrain', 'value' => 'AWD', 'unit' => null, 'label' => 'Antrieb'],
    ];
    $groups = [['key' => 'power', 'rows' => [['key' => 'power', 'source_label' => 'Herstellerangabe'], ['key' => 'torque', 'source_label' => 'Herstellerangabe']]]];

    app()->setLocale('de');
    $html = Blade::render(
        '<x-public.spec-strip :items="$a" :groups="$g" /><x-public.spec-strip :items="$a" :groups="$g" testid="X.second" /><x-public.spec-strip :items="$b" testid="X.third" /><style>@stack(\'sc-layout-css\')</style>',
        ['a' => $strip, 'g' => $groups, 'b' => $other],
    );
    $class = SpecStripLayout::className($this->items);
    $otherItems = SpecStripLayout::items(SpecStripLayout::entries($other, [], ['power' => 'Leistung', 'torque' => 'Drehmoment']));
    $otherClass = SpecStripLayout::className($otherItems);

    expect(substr_count($html, 'class="sc-strip-box text-body '.$class.'"'))->toBe(2)
        ->and(substr_count($html, SpecStripLayout::css($this->items, $class)))->toBe(1)
        ->and($otherClass)->not->toBe($class)
        ->and(substr_count($html, SpecStripLayout::css($otherItems, $otherClass)))->toBe(1);
});
