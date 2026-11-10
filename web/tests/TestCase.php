<?php

namespace Tests;

use App\Services\Rules\RateLimitOverrides;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        // The rate-limit overrides are read once per process (MF-2) when the app boots and defines its limiters: forget the previous
        // test's copy first, so this test's limiters come from this test's database and cache (code review M3.3-app SF-3).
        RateLimitOverrides::flush();

        parent::setUp();

        // Feature tests must not depend on a Vite build being present.
        $this->withoutVite();

        // Nothing leaves the machine: APP_URL in tests is the local dev server, which the doctor would otherwise ask.
        Http::preventStrayRequests();

    }

    protected function tearDown(): void
    {
        // TrustHosts writes the patterns into a static on Symfony's Request whenever a test runs a request outside the
        // testing environment (detectEnvironment('production')). Left there, a later test in the same process answers 400
        // for its host (HANDOFF RISK-5). The clock is reset by the framework's own tearDown.
        SymfonyRequest::setTrustedHosts([]);
        // The same for the proxies TrustConfiguredProxies sets on every request: a later request built outside the
        // middleware would believe X-Forwarded-For. -1 is Symfony's initial header set. Laravel flushes only its own statics.
        SymfonyRequest::setTrustedProxies([], -1);

        parent::tearDown();
    }
}
