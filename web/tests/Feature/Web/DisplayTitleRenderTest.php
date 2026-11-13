<?php

use App\Models\User;
use App\Support\DisplayTitleLayout;
use App\Support\KeepTogether;
use Illuminate\Support\Facades\Blade;
use Illuminate\Testing\TestResponse;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * ADR-426 on WEB-01 and WEB-03: every display.title carries the class of its rule, its container queries reach the page once,
 * inside the nonced style block (no style attributes under the CSP), and a car name keeps its trailing code with the word before it
 * only where the rule binds it (ADR-426 c as amended): its .sc-bind span, switched per width by the same queries.
 */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R R34', 'model_year' => 2002]);
});

/**
 * The nonced style blocks of a page, and the nonce its CSP allows.
 *
 * @return array{blocks: list<array{nonce: string, css: string}>, nonce: string|null}
 */
function titleStyles(TestResponse $response): array
{
    preg_match_all('~<style nonce="([^"]+)">(.*?)</style>~s', (string) $response->getContent(), $matches, PREG_SET_ORDER);
    preg_match("~style-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'~", (string) $response->headers->get('Content-Security-Policy'), $nonce);

    return ['blocks' => array_map(fn (array $match): array => ['nonce' => $match[1], 'css' => $match[2]], $matches), 'nonce' => $nonce[1] ?? null];
}

/**
 * @param  array{phone?: string, tablet?: string, desktop?: string}|string  $placements
 */
function expectTitleCss(TestResponse $response, string $text, array|string $placements, bool $name = true): string
{
    $class = DisplayTitleLayout::className($text, $placements, $name);
    $css = DisplayTitleLayout::css($text, $class, $placements, $name);
    $styles = titleStyles($response);
    $blocks = array_values(array_filter($styles['blocks'], fn (array $block): bool => str_contains($block['css'], '.sc-display-title.'.$class.'{')));

    expect($blocks)->toHaveCount(1)
        ->and(substr_count((string) $response->getContent(), $css))->toBe(1)
        ->and($blocks[0]['nonce'])->toBe($styles['nonce'])
        ->and($blocks[0]['css'])->toContain($css)
        // Unescaped, so the browser reads "<" and the quotes.
        ->and($blocks[0]['css'])->not->toContain('&lt;')
        ->and($blocks[0]['css'])->not->toContain('&quot;');

    return $class;
}

it('sets the WEB-01 title by the page rule on the hero at every width, 30/34 on phones and 44/48 from 1280 (ADR-426, DQ-1047/1048)', function () {
    $response = $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk();
    $class = expectTitleCss($response, 'Skyline GT-R R34', 'page');
    $css = DisplayTitleLayout::css('Skyline GT-R R34', $class, 'page', true);
    $scope = '.sc-display-title.'.$class;

    // Without photos the identity sits on the canvas (text-ink); with photos it is on the hero's stage in onPhoto colours.
    expect((string) $response->getContent())
        ->toMatch('~<div class="sc-title-box sc-veh-identity[^"]*">.*?<h1 class="sc-display-title t-display-title '.$class.' mt-4 w-fit text-(ink|on-photo)" data-testid="VEH-01.title">Skyline <span class="sc-bind"><span class="sc-keep">GT-R</span> R34</span></h1>~su')
        ->not->toContain('t-display-title-base '.$class)
        // "GT-R R34" stays together where it fits the line; below that it wraps at its space.
        ->and($css)->toContain($scope.' .sc-bind{white-space:nowrap}');
});

it('sets the WEB-03 claim by the page rule and the featured title by the page rule under the photo, the card rule on the tablet band and the page rule on the desktop band (ADR-426 b, DQ-929)', function () {
    $response = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk();
    $html = (string) $response->getContent();
    $placements = ['phone' => 'page', 'tablet' => 'card', 'desktop' => 'page'];
    $claim = expectTitleCss($response, 'Cars. People. Culture.', 'page', false);
    $featured = expectTitleCss($response, 'Nissan Skyline GT-R R34', $placements);
    $css = DisplayTitleLayout::css('Nissan Skyline GT-R R34', $featured, $placements, true);
    $scope = '.sc-display-title.'.$featured;
    $full = '{font-size:var(--sc-type-display-title-size);line-height:var(--sc-type-display-title-line);letter-spacing:var(--sc-type-display-title-tracking)}';
    $base = '{font-size:var(--sc-type-display-title-base-size);line-height:var(--sc-type-display-title-base-line);letter-spacing:var(--sc-type-display-title-base-tracking)}';

    expect($html)->toMatch('~<div class="sc-land-hero-block sc-title-box">\s*<h1 class="sc-display-title t-display-title '.$claim.' text-on-photo" data-testid="WEB-03.claim">Cars. People. Culture.</h1>~')
        ->and($html)->toMatch('~<span class="sc-feature-text sc-title-box">.*?<span class="sc-display-title t-display-title-base '.$featured.' sc-feature-title block" id="feature-title" data-testid="WEB-03.featuredTitle">Nissan Skyline <span class="sc-bind"><span class="sc-keep">GT-R</span> R34</span></span>~su')
        ->and(DisplayTitleLayout::css('Cars. People. Culture.', $claim, 'page'))->toContain('@media (min-width: 1280px){.sc-display-title.'.$claim.'{font-size:var(--sc-type-display-title-size);')
        // The claim is not a car name: nothing to bind.
        ->and(DisplayTitleLayout::css('Cars. People. Culture.', $claim, 'page'))->not->toContain('sc-bind')
        ->and(DisplayTitleLayout::placements($placements))->toBe($placements)
        // Tablet band: the card rule, 30/34 (the phone pair at every width).
        ->and($css)->toContain('@media (min-width: 768px) and (max-width: 1279.98px){'.$scope.$base)
        // Desktop band from 1280: no card, the page rule at the role's desktop size, 44/48 (tokens: --sc-type-display-title-* from 1280).
        ->and($css)->toContain('@media (min-width: 1280px){'.$scope.$full)
        ->and($css)->not->toContain('@media (min-width: 1280px){'.$scope.$base)
        ->and($css)->toContain($scope.' .sc-bind{white-space:nowrap}')
        // At the QA font scale too: the desktop band takes the page rule.
        ->and($css)->toContain('@media (min-width: 1280px){:root[data-qa-font-scale="2"] '.$scope.$full);

    // 44/48 holds while the name needs at most 2 lines on the desktop band (frame 1248 less the gutters).
    expect(DisplayTitleLayout::state('Nissan Skyline GT-R R34', 1200.0, 'page', true, 1.0, true)['size'])->toBe((float) DisplayTitleLayout::SIZE_DESKTOP);
});

it('estimates the text it prints: the name, its pair bound per width, and the CSS once for two identical titles', function () {
    $html = Blade::render(
        '<div class="sc-title-box"><x-public.display-title :text="$name" /></div><div class="sc-title-box"><x-public.display-title :text="$name" as="h2" /></div><x-public.display-title text="Golf GTI" placement="card" :base="true" /><style>@stack(\'sc-layout-css\')</style>',
        ['name' => 'Volkswagen Golf GTI VIII (CD)'],
    );
    $text = KeepTogether::titleText('Volkswagen Golf GTI VIII (CD)');
    $class = DisplayTitleLayout::className($text, 'page', true);
    $card = DisplayTitleLayout::className('Golf GTI', 'card', true);

    expect($text)->toBe('Volkswagen Golf GTI VIII (CD)')
        ->and(substr_count($html, 'class="sc-display-title t-display-title '.$class.'"'))->toBe(2)
        ->and($html)->toContain('<h2 class="sc-display-title t-display-title '.$class.'">Volkswagen Golf GTI <span class="sc-bind">VIII (CD)</span></h2>')
        ->and(substr_count($html, DisplayTitleLayout::css($text, $class, 'page', true)))->toBe(1)
        ->and(DisplayTitleLayout::css($text, $class, 'page', true))->toContain('@container sc-title (width < 102.03px)')
        // Two words: nothing to bind, no span.
        ->and($html)->toContain('class="sc-display-title t-display-title-base '.$card.'">Golf GTI</h1>')
        ->and(substr_count($html, DisplayTitleLayout::css('Golf GTI', $card, 'card', true)))->toBe(1);
});

it('never binds a two-word name on the page (Porsche 911, MF-R3-2)', function () {
    $html = Blade::render('<div class="sc-title-box"><x-public.display-title text="Porsche 911" /></div><style>@stack(\'sc-layout-css\')</style>');

    expect($html)->toContain('>Porsche 911</h1>')
        ->and($html)->not->toContain('sc-bind')
        ->and($html)->not->toContain("\u{00A0}");
});

it('escapes a member-typed name in the title and never lets it into the CSS', function () {
    $html = Blade::render('<x-public.display-title :text="$name" /><style>@stack(\'sc-layout-css\')</style>', ['name' => '</style><script>x</script> RS']);

    expect($html)->toContain('&lt;/style&gt;&lt;script&gt;x&lt;/script&gt;')
        ->and($html)->not->toContain('<script>')
        ->and(substr_count($html, '</style>'))->toBe(1);
});

it('balances a display title and never hyphenates it automatically (ADR-426 c)', function () {
    $css = (string) file_get_contents(resource_path('css/public.css'));

    expect($css)->toContain('.sc-title-box { container: sc-title / inline-size; }')
        ->and($css)->toContain('.sc-strip-box { container: sc-strip / inline-size; }')
        // The pair span wraps like the text around it unless the pushed queries bind it.
        ->and($css)->not->toMatch('/\.sc-bind\s*\{/')
        ->and($css)->toContain('.sc-display-title { text-wrap: balance; -webkit-hyphens: manual; hyphens: manual; }');
});
