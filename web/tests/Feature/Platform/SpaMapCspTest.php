<?php

use App\Http\Csp\SpaPreset;

/**
 * ADR-449: the /app CSP lets the event map load (MapLibre from unpkg, blob: workers, OpenFreeMap tiles); nothing else gets those hosts.
 */
/**
 * @return array<string, string>
 */
function spaMapCsp(string $header): array
{
    $directives = [];

    foreach (explode(';', $header) as $directive) {
        [$name, $value] = array_pad(explode(' ', trim($directive), 2), 2, '');
        $directives[$name] = $value;
    }

    return $directives;
}

beforeEach(function () {
    $this->index = tempnam(sys_get_temp_dir(), 'spa');
    file_put_contents($this->index, '<script>var a = 1;</script>');
    config(['speedclub.spa.index' => $this->index]);
});

afterEach(function () {
    @unlink($this->index);
});

it('allows the event map on /app and its deep links', function (string $uri) {
    $csp = spaMapCsp((string) $this->get($uri)->assertOk()->headers->get('Content-Security-Policy'));

    expect($csp['script-src'])->toContain(SpaPreset::MAP_LIBRARY_HOST)->not->toContain('unsafe')
        ->and($csp['style-src'])->toContain(SpaPreset::MAP_LIBRARY_HOST)
        ->and($csp['worker-src'])->toBe("'self' blob:")
        ->and($csp['child-src'])->toBe("'self' blob:")
        ->and($csp['connect-src'])->toContain(SpaPreset::MAP_TILES_HOST)
        ->and($csp['img-src'])->toContain(SpaPreset::MAP_TILES_HOST)
        // The map runs in the page; it never frames anything, and nothing frames the app.
        ->and($csp['frame-ancestors'])->toBe("'none'")
        ->and($csp)->not->toHaveKey('frame-src');
})->with(['/app', '/app/events/map']);

it('keeps the map hosts out of the public pages, the admin and the API', function (string $uri) {
    $header = (string) $this->get($uri)->headers->get('Content-Security-Policy');

    expect($header)->not->toBeEmpty()
        ->and($header)->not->toContain(SpaPreset::MAP_LIBRARY_HOST)
        ->and($header)->not->toContain(SpaPreset::MAP_TILES_HOST)
        ->and(spaMapCsp($header))->not->toHaveKey('worker-src');
})->with(['/', '/admin/login', '/api/v1/app-config']);
