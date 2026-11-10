<?php

use App\Models\Staff;
use App\Support\TrustedHosts;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Notification;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

afterEach(function () {
    SymfonyRequest::setTrustedHosts([]);
});

it('trusts only the host of APP_URL and the configured extras', function () {
    config(['app.url' => 'https://speedclub.de', 'speedclub.trusted_hosts' => ['www.speedclub.de']]);

    expect(TrustedHosts::patterns())->toBe(['^speedclub\.de$', '^www\.speedclub\.de$']);
});

it('rejects a foreign Host header outside local', function () {
    config(['app.url' => 'https://speedclub.de', 'speedclub.trusted_hosts' => []]);
    app()->detectEnvironment(fn () => 'production');

    $this->get('https://evil.example/up')->assertStatus(400);

    SymfonyRequest::setTrustedHosts([]);

    $this->get('https://speedclub.de/up')->assertOk();
});

it('does not trust subdomains or lookalikes', function () {
    config(['app.url' => 'https://speedclub.de', 'speedclub.trusted_hosts' => []]);
    app()->detectEnvironment(fn () => 'production');

    $this->get('https://evil.speedclub.de/up')->assertStatus(400);

    SymfonyRequest::setTrustedHosts([]);

    $this->get('https://speedclub.de.evil.example/up')->assertStatus(400);
});

it('builds the staff reset link from APP_URL, never from the Host header', function () {
    Notification::fake();
    config(['app.url' => 'https://speedclub.de']);
    $staff = Staff::factory()->create();

    // withoutMiddleware() also drops the middleware that runs deferred work; the reset mail leaves after the response.
    $this->withoutMiddleware()
        ->withoutDefer()
        ->post('http://evil.example/admin/forgot-password', ['email' => $staff->email]);

    Notification::assertSentTo($staff, ResetPassword::class, function (ResetPassword $notification) use ($staff): bool {
        $link = (ResetPassword::$createUrlCallback)($staff, $notification->token);

        return str_starts_with($link, 'https://speedclub.de/admin/reset#token=') && ! str_contains($link, 'evil.example');
    });
});
