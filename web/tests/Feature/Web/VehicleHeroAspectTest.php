<?php

use App\Models\User;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * WEB-01 follows the app's VEH-01 crops (client feedback CF-1, CF-2, M5.3): the hero is aspect.hero (4:5) on a phone, aspect.heroWeb
 * (16:9) from 768 and aspect.heroDesktop (21:9) from 1280, read from the generated tokens (never a raw ratio); the identity keeps
 * starting on the scrim's text-safe line (17.6 % of the hero's height) whatever the crop; the SpecStrip numerals are hero.numeral.xs
 * on a phone (R5-2b, ADR-536), hero.numeral from 768 and hero.numeral.s in the desktop card, with tabular figures.
 */
function vhaFile(string $path): string
{
    return (string) file_get_contents(dirname(__DIR__, 3).'/'.$path);
}

/** The declarations of `$selector` inside the block that starts with `$at` ('' = outside any media query). */
function vhaRule(string $css, string $at, string $selector): ?string
{
    $scope = $at === '' ? $css : substr($css, (int) strpos($css, $at));

    return preg_match('/(?:^|\n)\s*'.preg_quote($selector, '/').' \{([^}]*)\}/', $scope, $match) === 1 ? trim($match[1]) : null;
}

it('generates every photo crop of tokens.json as a CSS ratio and its height per width', function () {
    $tokens = json_decode(vhaFile('../design/tokens/tokens.json'), true, 512, JSON_THROW_ON_ERROR)['aspect'];
    $css = vhaFile('resources/css/tokens.generated.css');

    expect($tokens['heroDesktop'])->toBe('21:9');

    foreach (['hero' => 'hero', 'heroWeb' => 'hero-web', 'heroDesktop' => 'hero-desktop'] as $key => $name) {
        [$w, $h] = array_map('intval', explode(':', $tokens[$key]));
        expect($css)->toContain("--sc-aspect-$name: $w / $h;")
            ->and($css)->toContain("--sc-aspect-$name-height: ".round($h / $w, 4).';');
    }
});

it('crops the WEB-01 hero by the tokens: 4:5, 16:9 from 768, 21:9 from 1280, with the identity on the text-safe line', function () {
    $css = vhaFile('resources/css/public.css');
    $desktop = '@media (min-width: 1280px) {'."\n".'  .sc-veh {';

    expect(vhaRule($css, '', '.sc-hero'))->toContain('aspect-ratio: var(--sc-aspect-hero);')
        ->and(vhaRule($css, '/* DQ-1048: 16:9', '.sc-hero'))->toBe('aspect-ratio: var(--sc-aspect-hero-web);')
        ->and(vhaRule($css, '/* DQ-1048: 16:9', '.sc-hero-identity'))->toBe('margin-top: calc(-17.6% * var(--sc-aspect-hero-web-height));')
        ->and(vhaRule($css, $desktop, '.sc-hero'))->toBe('aspect-ratio: var(--sc-aspect-hero-desktop);')
        ->and(vhaRule($css, $desktop, '.sc-hero-identity'))->toBe('margin-top: calc(-17.6% * var(--sc-aspect-hero-desktop-height));')
        // No raw ratio left on the hero.
        ->and($css)->not->toMatch('/\.sc-hero \{[^}]*aspect-ratio: \d/');
});

it('sets the strip numerals per width as the app does, tabular figures kept', function () {
    $css = vhaFile('resources/css/public.css');

    expect(vhaRule($css, '', '.sc-strip-numeral'))->toContain('font-size: var(--sc-type-hero-numeral-xs-size);')
        ->and(vhaRule($css, '', '.sc-strip-numeral'))->toContain('font-variant-numeric: tabular-nums;')
        ->and(vhaRule($css, '@media (min-width: 768px) {'."\n".'  .sc-strip-numeral', '.sc-strip-numeral'))->toContain('font-size: var(--sc-type-hero-numeral-size);')
        ->and(vhaRule($css, '@media (min-width: 1280px) {'."\n".'  .sc-strip-numeral', '.sc-strip-numeral'))->toContain('font-size: var(--sc-type-hero-numeral-s-size);');
});

it('labels the owner\'s description "Beschreibung" above the text, and shows no label without one (CF-3)', function () {
    $vehicle = publishedVehicle(User::factory()->create(), ['description' => 'Alltagsauto mit Gewindefahrwerk.']);
    $empty = publishedVehicle(User::factory()->create(), ['description' => null]);

    // The test app answers in English; the German label is checked on the translation itself.
    $this->get('/v/'.$vehicle->canonicalSlug())->assertOk()
        ->assertSeeInOrder(['data-testid="WEB-01.descriptionTitle">Description</h3>', 'Alltagsauto mit Gewindefahrwerk.'], false);
    $this->get('/v/'.$empty->canonicalSlug())->assertOk()->assertDontSee('WEB-01.descriptionTitle', false);
    expect(__('public.vehicle.description_title', [], 'de'))->toBe('Beschreibung');
});
