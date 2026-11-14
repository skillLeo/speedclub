<?php

use App\Http\Csp\SpaPreset;

/**
 * SEC-414-04: the /app CSP never trusts a whole third-party origin for scripts or styles. A host source would allow every file of that
 * host (unpkg serves any npm package), so any HTML injection in the member web could load an attacker's script. Every source of
 * script-src and style-src is 'self', a keyword, a hash, or an exact https file; the map library is served from this origin with the
 * npm package's own bytes.
 */
beforeEach(function () {
    $this->index = tempnam(sys_get_temp_dir(), 'spa');
    file_put_contents($this->index, '<script>var a = 1;</script>');
    config(['speedclub.spa.index' => $this->index]);
});

afterEach(function () {
    @unlink($this->index);
});

/**
 * @return array<string, list<string>>
 */
function spaCspSources(string $header): array
{
    $directives = [];

    foreach (array_filter(array_map('trim', explode(';', $header))) as $directive) {
        $parts = preg_split('/\s+/', $directive) ?: [];
        $directives[(string) array_shift($parts)] = $parts;
    }

    return $directives;
}

it('names no bare third-party origin in script-src or style-src of /app', function (string $uri) {
    $csp = spaCspSources((string) $this->get($uri)->assertOk()->headers->get('Content-Security-Policy'));

    foreach (['script-src', 'style-src'] as $directive) {
        expect($csp)->toHaveKey($directive);

        foreach ($csp[$directive] as $source) {
            if (str_starts_with($source, "'")) {
                expect($source)->toMatch("/\\A'(self|unsafe-inline|sha256-[A-Za-z0-9+\\/=]+|nonce-[A-Za-z0-9+\\/=]+)'\\z/");

                continue;
            }

            // An exact file: https, a host and a path with a file name, never a wildcard or a scheme alone.
            expect($source)->toMatch('#\Ahttps://[a-z0-9.-]+/[^*\s]*[^/*\s]\.(js|css)\z#', "$directive allows $source");
        }
    }

    expect($csp['script-src'])->not->toContain("'unsafe-inline'")->not->toContain("'unsafe-eval'");
})->with(['/app', '/app/events/map']);

it('serves the self-hosted map library with the npm package bytes', function (string $file) {
    $path = public_path(ltrim(SpaPreset::MAP_LIBRARY_PATH, '/').'/'.$file);

    expect(is_file($path))->toBeTrue()
        ->and('sha384-'.base64_encode(hash_file('sha384', $path, true)))->toBe(SpaPreset::MAP_LIBRARY_SRI[$file])
        ->and(is_file(public_path(ltrim(SpaPreset::MAP_LIBRARY_PATH, '/').'/LICENSE.txt')))->toBeTrue();
})->with(['maplibre-gl.js', 'maplibre-gl.css']);
