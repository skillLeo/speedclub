<?php

use Illuminate\Support\Facades\Route;

/**
 * @return array<string, string>
 */
function cspOf(string $header): array
{
    $directives = [];

    foreach (explode(';', $header) as $directive) {
        [$name, $value] = array_pad(explode(' ', trim($directive), 2), 2, '');
        $directives[$name] = $value;
    }

    return $directives;
}

it('sets the baseline headers everywhere', function (string $uri, int $status) {
    $response = $this->get($uri)->assertStatus($status);

    expect($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->headers->get('X-Frame-Options'))->toBe('DENY')
        ->and($response->headers->get('Referrer-Policy'))->toBe('strict-origin-when-cross-origin')
        ->and($response->headers->get('Permissions-Policy'))->toContain('geolocation=()')
        ->and($response->headers->get('Content-Security-Policy'))->not->toBeEmpty();
})->with([
    'blade' => ['/', 200],
    'api' => ['/api/v1/app-config', 200],
    'api error' => ['/api/v1/does-not-exist', 404],
    'admin' => ['/admin/login', 200],
]);

it('sends HSTS only over HTTPS', function () {
    expect($this->get('/')->headers->has('Strict-Transport-Security'))->toBeFalse()
        ->and($this->get('https://localhost/')->headers->get('Strict-Transport-Security'))->toContain('max-age=31536000');
});

it('closes the JSON API completely', function () {
    expect($this->getJson('/api/v1/app-config')->headers->get('Content-Security-Policy'))
        ->toBe("default-src 'none';frame-ancestors 'none'");
});

describe('Blade and admin', function () {
    it('uses a fresh nonce for every request and no unsafe keyword', function (string $uri) {
        $first = cspOf($this->get($uri)->headers->get('Content-Security-Policy'));
        $second = cspOf($this->get($uri)->headers->get('Content-Security-Policy'));

        expect($first['script-src'])->toMatch("/'nonce-[^']+'/")
            ->and($first['style-src'])->toMatch("/'nonce-[^']+'/")
            ->and($first['script-src'])->not->toContain('unsafe')
            ->and($first['style-src'])->not->toContain('unsafe')
            ->and($first['object-src'])->toBe("'none'")
            ->and($first['frame-ancestors'])->toBe("'none'")
            ->and($first['base-uri'])->toBe("'self'");

        // The container keeps one nonce per test application, so a new request needs a new instance.
        app()->forgetScopedInstances();

        expect(cspOf($this->get($uri)->headers->get('Content-Security-Policy'))['script-src'])->not->toBe($second['script-src']);
    })->with(['/', '/admin/login']);

    it('allows by hash only the empty rule WebKit screenshots insert, and only outside production', function (string $environment, bool $allowed) {
        app()->detectEnvironment(fn () => $environment);
        $hash = "'sha256-".base64_encode(hash('sha256', 'body {}', true))."'";

        $styles = cspOf($this->get('/')->headers->get('Content-Security-Policy'))['style-src'];

        expect(str_contains($styles, $hash))->toBe($allowed)
            ->and($hash)->toBe("'sha256-YjaKGiklmzC6wjXA513HAMmzus8VE61XCOT+SmwNZWA='")
            ->and(preg_match_all("/'sha256-/", $styles))->toBe($allowed ? 1 : 0)
            ->and($styles)->not->toContain('unsafe');
    })->with([
        'local' => ['local', true],
        'staging' => ['staging', true],
        'production' => ['production', false],
    ]);

    it('allows in style attributes only the declaration WebKit writes into a native select, in every environment', function (string $environment) {
        app()->detectEnvironment(fn () => $environment);

        $csp = cspOf($this->get('/melden')->headers->get('Content-Security-Policy'));

        // Exactly one hash, of exactly `text-overflow:inherit`; no 'unsafe-inline', no nonce (nonces never cover attributes).
        expect($csp['style-src-attr'] ?? null)->toBe("'unsafe-hashes' 'sha256-3oFxofzq3N//6J8H86e9ul4WT2OkJrtonB66gn/TLJw='")
            ->and("'sha256-".base64_encode(hash('sha256', 'text-overflow:inherit', true))."'")->toBe("'sha256-3oFxofzq3N//6J8H86e9ul4WT2OkJrtonB66gn/TLJw='")
            ->and($csp['style-src'])->not->toContain('unsafe');
    })->with(['local', 'production']);

    it('renders the native selects of WEB-09 and WEB-10 without any style attribute of its own', function (string $uri) {
        $html = (string) $this->get($uri)->assertOk()->getContent();

        expect($html)->toMatch('/<select\b/')->not->toMatch('/<[^>]+\sstyle="/');
    })->with(['/melden', '/kontakt']);

    it('puts the nonce of the header on every inline script', function (string $uri) {
        $response = $this->get($uri);

        preg_match("/'nonce-([^']+)'/", cspOf($response->headers->get('Content-Security-Policy'))['script-src'], $match);
        preg_match_all('/<script\b([^>]*)>/i', $response->getContent(), $scripts);

        expect($scripts[1])->not->toBeEmpty();

        foreach ($scripts[1] as $attributes) {
            // Data blocks do not execute, so CSP does not apply to them.
            if (! str_contains($attributes, 'application/json')) {
                expect($attributes)->toContain('nonce="'.$match[1].'"');
            }
        }
    })->with(['/', '/admin/login']);

    it('has no inline style attribute in the public pages', function () {
        expect($this->get('/')->getContent())->not->toMatch('/<[^>]+\sstyle="/');
    });

    it('has no inline style attribute in the icon sprite', function () {
        expect(view('components.icons.auto-sprite')->render())->not->toContain('style=');
    });
});

describe('/app', function () {
    beforeEach(function () {
        $this->index = tempnam(sys_get_temp_dir(), 'spa');
        config(['speedclub.spa.index' => $this->index]);
    });

    afterEach(function () {
        @unlink($this->index);
    });

    it('allows the inline script by hash and nothing else', function () {
        $script = "\n  (function () { document.documentElement.lang = 'de'; })();\n";
        file_put_contents($this->index, "<!doctype html><head><script id=\"boot\">$script</script><script src=\"/app/x.js\" defer></script></head>");

        $csp = cspOf($this->get('/app')->assertOk()->headers->get('Content-Security-Policy'));
        $hash = base64_encode(hash('sha256', $script, true));

        // ADR-449: the map library host is the one other source (SpaMapCspTest).
        expect($csp['script-src'])->toBe("'self' 'sha256-$hash' https://unpkg.com")
            ->and($csp['script-src'])->not->toContain('unsafe')
            ->and($csp['script-src'])->not->toContain('nonce')
            ->and($csp['object-src'])->toBe("'none'")
            ->and($csp['frame-ancestors'])->toBe("'none'");
    });

    it('hashes what the browser hashes when the file has CRLF line ends', function () {
        file_put_contents($this->index, "<script>\r\nvar a = 1;\r\n</script>");

        $csp = cspOf($this->get('/app')->headers->get('Content-Security-Policy'));

        expect($csp['script-src'])->toContain('sha256-'.base64_encode(hash('sha256', "\nvar a = 1;\n", true)));
    });

    it('follows a new export', function () {
        file_put_contents($this->index, '<script>var a = 1;</script>');
        $first = cspOf($this->get('/app')->headers->get('Content-Security-Policy'))['script-src'];

        file_put_contents($this->index, '<script>var a = 2;</script>');
        $second = cspOf($this->get('/app')->headers->get('Content-Security-Policy'))['script-src'];

        expect($first)->not->toBe($second);
    });

    it('covers deep links too', function () {
        file_put_contents($this->index, '<script>var a = 1;</script>');

        expect(cspOf($this->get('/app/garage/new/step-2')->headers->get('Content-Security-Policy'))['script-src'])
            ->toContain('sha256-');
    });

    it('matches the real exported page, when there is one', function () {
        $exported = public_path('app/index.html');

        if (! is_file($exported)) {
            $this->markTestSkipped('No Expo export in public/app.');
        }

        config(['speedclub.spa.index' => $exported]);
        $html = str_replace(["\r\n", "\r"], "\n", (string) file_get_contents($exported));

        preg_match('/<script id="sc-theme-boot">(.*?)<\/script>/s', $html, $boot);
        expect($boot)->not->toBeEmpty();

        $csp = cspOf($this->get('/app')->assertOk()->headers->get('Content-Security-Policy'));

        expect($csp['script-src'])
            ->toContain("'sha256-".base64_encode(hash('sha256', $boot[1], true))."'")
            ->not->toContain('unsafe');
    });

    it('adds the realtime hosts only when Pusher is configured', function () {
        file_put_contents($this->index, '<p>x</p>');

        expect(cspOf($this->get('/app')->headers->get('Content-Security-Policy'))['connect-src'])->toBe("'self' https://tiles.openfreemap.org");

        // M2.4: realtime needs all four Pusher values and the pusher broadcaster (App\Services\Messaging\Realtime).
        config(['broadcasting.default' => 'pusher', 'broadcasting.connections.pusher.key' => 'public-key', 'broadcasting.connections.pusher.secret' => 'secret', 'broadcasting.connections.pusher.app_id' => '1', 'broadcasting.connections.pusher.options.cluster' => 'eu']);

        expect(cspOf($this->get('/app')->headers->get('Content-Security-Policy'))['connect-src'])
            ->toContain('wss://ws-eu.pusher.com')
            ->toContain('https://sockjs-eu.pusher.com');
    });

    it('uses the Blade policy for the friendly page when nothing is exported', function () {
        config(['speedclub.spa.index' => $this->index.'.missing']);

        expect(cspOf($this->get('/app')->assertNotFound()->headers->get('Content-Security-Policy'))['script-src'])
            ->toContain("'nonce-");
    });
});

it('can be switched off', function () {
    config(['csp.enabled' => false]);

    expect($this->get('/')->headers->has('Content-Security-Policy'))->toBeFalse();
});

it('adds media hosts when the media disk is a bucket', function () {
    config([
        'speedclub.media.disk' => 'media-bucket',
        'filesystems.disks.media-bucket' => ['driver' => 'local', 'root' => sys_get_temp_dir(), 'url' => 'https://cdn.example.test/m'],
    ]);

    // A local driver stays same-origin, whatever its URL says.
    expect(cspOf($this->get('/')->headers->get('Content-Security-Policy'))['img-src'])->not->toContain('cdn.example.test');
});

it('does not disturb a route that sets its own policy', function () {
    Route::get('/own-policy', fn () => response('x')->header('Content-Security-Policy', "default-src 'none'"));

    expect($this->get('/own-policy')->headers->get('Content-Security-Policy'))->toBe("default-src 'none'");
});
