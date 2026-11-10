<?php

use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

/**
 * HANDOFF RISK-5: static state that one test leaves behind must not reach the next one in the same process. The two tests
 * depend on running in this order (pairs), which Pest keeps within a file (also under --parallel, one file per process).
 */
it('leaves the trusted hosts of a production request behind', function () {
    config(['app.url' => 'https://speedclub.de', 'speedclub.trusted_hosts' => []]);
    app()->detectEnvironment(fn () => 'production');

    $this->get('https://speedclub.de/up')->assertOk();

    expect(SymfonyRequest::getTrustedHosts())->not->toBe([]);
});

it('starts the next test without them', function () {
    expect(SymfonyRequest::getTrustedHosts())->toBe([]);

    $this->get('http://another-host.test/up')->assertOk();
});

it('leaves a frozen clock behind', function () {
    $this->travelTo(now()->subYears(3));

    expect(now()->timestamp)->toBeLessThan(time() - 86400);
});

it('starts the next test on the real clock', function () {
    expect(abs(now()->timestamp - time()))->toBeLessThan(5);
});

it('leaves the trusted proxies of a request behind', function () {
    config(['speedclub.trusted_proxies' => ['*']]);

    $this->get('/up')->assertOk();

    expect(SymfonyRequest::getTrustedProxies())->not->toBe([]);
});

it('starts the next test without trusted proxies', function () {
    expect(SymfonyRequest::getTrustedProxies())->toBe([]);

    // A request built outside the middleware must not believe a forwarded address.
    $request = SymfonyRequest::create('/', server: ['REMOTE_ADDR' => '127.0.0.1', 'HTTP_X_FORWARDED_FOR' => '203.0.113.9']);

    expect($request->getClientIp())->toBe('127.0.0.1');
});
