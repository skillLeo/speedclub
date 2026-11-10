<?php

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Symfony\Component\Process\Process;

/**
 * Controls of the M1.5 audit (docs/07_QA_AND_RELEASE.md §6) that no other test in this directory proves yet.
 */
describe('stack traces in logs', function () {
    it('drops string arguments outside the local environments, whatever php.ini says', function (string $environment) {
        $script = 'require "vendor/autoload.php"; $app = require "bootstrap/app.php"; $app->make('.var_export(Kernel::class, true).')->bootstrap(); echo ini_get("zend.exception_ignore_args");';

        $process = new Process(
            [PHP_BINARY, '-d', 'zend.exception_ignore_args=0', '-r', 'eval(base64_decode("'.base64_encode($script).'"));'],
            base_path(),
            ['APP_ENV' => $environment],
        );
        $process->mustRun();

        expect($process->getOutput())->toBe('1');
    })->with(['production', 'staging']);
});

describe('a token whose member lost access', function () {
    it('answers per the policy on every route', function (UserStatus $status, array $expected) {
        $member = User::factory()->create(['email_verified_at' => now(), 'status' => $status]);
        $token = $member->createToken('P', ['member'], now()->addDay())->plainTextToken;

        foreach ($expected as $route => $code) {
            [$method, $path] = explode(' ', $route);

            app('auth')->forgetGuards();

            $this->withToken($token)
                ->json($method, '/api/v1/'.$path, $method === 'PUT' ? ['username' => 'neuer.name'] : [])
                ->assertStatus($code);
        }

        expect($member->refresh()->username)->not->toBe('neuer.name');
    })->with([
        'deactivated' => [UserStatus::Deactivated, [
            'GET auth/me' => 403,
            'GET me/profile' => 403,
            'PATCH me/profile' => 403,
            'PUT me/username' => 403,
            'GET me/settings' => 403,
            'PATCH me/settings' => 403,
            'POST auth/token/rotate' => 403,
        ]],
        'suspended' => [UserStatus::Suspended, [
            'GET auth/me' => 200,
            'GET me/profile' => 200,
            'PATCH me/profile' => 403,
            'PUT me/username' => 403,
            'GET me/settings' => 200,
            'PATCH me/settings' => 200,
            'POST auth/token/rotate' => 403,
        ]],
    ]);
});

describe('SPA cookies', function () {
    it('keeps the session cookie from scripts and cross-site POSTs, and sends both cookies over HTTPS only when asked to', function () {
        config(['session.driver' => 'database', 'session.secure' => true]);
        app()->forgetInstance('session.store');

        $response = $this->withHeaders(['Origin' => 'http://localhost:8080'])->get('/sanctum/csrf-cookie')->assertNoContent();

        $session = $response->getCookie(config()->string('session.cookie'));
        $xsrf = $response->getCookie('XSRF-TOKEN', decrypt: false);

        expect($session->isHttpOnly())->toBeTrue()
            ->and($session->isSecure())->toBeTrue()
            ->and(strtolower((string) $session->getSameSite()))->toBe('lax')
            ->and($xsrf->isHttpOnly())->toBeFalse()
            ->and($xsrf->isSecure())->toBeTrue()
            ->and(strtolower((string) $xsrf->getSameSite()))->toBe('lax');
    });
});

describe('rate limits of 02_PRODUCT_SPEC §8', function () {
    it('has each limiter on its route, with the numbers of the spec', function (string $method, string $path, string $middleware, string $limit, int $max, int $minutes) {
        $route = Route::getRoutes()->match(Request::create($path, $method));

        expect($route->gatherMiddleware())->toContain($middleware)
            ->and(config()->integer("speedclub.rate_limits.$limit.max"))->toBe($max)
            ->and(config()->integer("speedclub.rate_limits.$limit.minutes"))->toBe($minutes);
    })->with([
        'register' => ['POST', '/api/v1/auth/register', 'throttle:member-register', 'member_register', 5, 60],
        'login' => ['POST', '/api/v1/auth/login', 'throttle:member-login', 'member_login', 10, 1],
        'verify' => ['POST', '/api/v1/auth/email/verify', 'throttle:member-verify', 'member_verify', 30, 1],
        'reset' => ['POST', '/api/v1/auth/password/reset', 'throttle:member-verify', 'member_verify', 30, 1],
        'resend' => ['POST', '/api/v1/auth/email/resend', 'throttle:member-email', 'member_email', 10, 10],
        'forgot' => ['POST', '/api/v1/auth/password/forgot', 'throttle:member-email', 'member_email', 10, 10],
        'avatar' => ['POST', '/api/v1/me/avatar', 'throttle:uploads', 'uploads', 60, 60],
        'cover' => ['POST', '/api/v1/me/cover', 'throttle:uploads', 'uploads', 60, 60],
    ]);

    it('stops guesses on verify at the limit per IP', function () {
        foreach (range(1, 30) as $request) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'wer@example.de'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'wer@example.de'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited');
    });
});
