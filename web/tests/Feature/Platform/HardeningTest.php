<?php

use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

/**
 * Reads a config file as if the app ran with these variables, for values that are fixed when the config loads.
 *
 * @param  array<string, string>  $env
 * @return array<string, mixed>
 */
function configFileUnder(string $file, array $env): array
{
    $saved = [];

    foreach ($env as $key => $value) {
        $saved[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null];
        $_ENV[$key] = $_SERVER[$key] = $value;
    }

    try {
        return require config_path($file);
    } finally {
        foreach ($saved as $key => [$environment, $server]) {
            if ($environment === null) {
                unset($_ENV[$key]);
            } else {
                $_ENV[$key] = $environment;
            }

            if ($server === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $server;
            }
        }
    }
}

describe('SEC-103 suspended status', function () {
    it('counts as suspended without a suspension entry', function (?array $restrictions) {
        $user = User::factory()->create();
        $user->forceFill(['status' => UserStatus::Suspended, 'restrictions' => $restrictions])->save();

        expect($user->isSuspended())->toBeTrue()
            ->and($user->isPubliclyVisible())->toBeFalse()
            ->and($user->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
            ->and($user->restrictedUntil(RestrictionType::Publishing))->toBeNull();
    })->with([
        'null' => [null],
        'empty' => [[]],
        'other restriction only' => [['messaging' => ['until' => null]]],
        'empty entry' => [['suspension' => null]],
    ]);

    it('fails closed on an unreadable date', function () {
        $user = User::factory()->create();
        $user->forceFill(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => 'kaputt']]])->save();

        expect($user->isSuspended())->toBeTrue()
            ->and($user->restrictedUntil(RestrictionType::Publishing))->toBeNull();
    });

    it('keeps the suspension unless the end is a real date', function (mixed $until) {
        $user = User::factory()->create();
        $user->forceFill(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => $until]]])->save();

        expect($user->isSuspended())->toBeTrue()
            ->and($user->restrictedUntil(RestrictionType::Publishing))->toBeNull()
            ->and($user->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue();
    })->with([
        'empty' => [''],
        'space' => [' '],
        'relative word' => ['tomorrow'],
        'yesterday' => ['yesterday'],
        'number' => [1700000000],
        'zero' => [0],
        'false' => [false],
        'list' => [['2020-01-01']],
        'nonsense date' => ['2020-02-31'],
        'german format' => ['01.01.2020'],
        'trailing text' => ['2020-01-01 evil'],
    ]);

    it('reads an ISO 8601 end strictly', function (string $until, bool $suspended) {
        $user = User::factory()->create();
        $user->forceFill(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => $until]]])->save();

        expect($user->isSuspended())->toBe($suspended);
    })->with([
        'past with offset' => ['2020-01-01T00:00:00+00:00', false],
        'past in Z' => ['2020-01-01T00:00:00Z', false],
        'past day' => ['2020-01-01', false],
        'future' => ['2999-01-01T00:00:00+00:00', true],
    ]);

    it('holds the same for restrictions other than a suspension', function () {
        $user = User::factory()->create(['restrictions' => ['messaging' => ['until' => '']]]);

        expect($user->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue();
    });

    it('still ends a suspension whose date has passed', function () {
        expect(User::factory()->suspended(now()->subDay())->create()->isSuspended())->toBeFalse()
            ->and(User::factory()->suspended(now()->addDay())->create()->isSuspended())->toBeTrue();
    });

    it('does not make an active member suspended', function () {
        expect(User::factory()->create(['restrictions' => null])->isSuspended())->toBeFalse();
    });

    it('stops the member at the API with no end date', function () {
        Route::middleware(['api', 'auth:sanctum', 'not-restricted:publishing'])->post('api/v1/test-publish', fn () => response()->noContent());
        $user = User::factory()->create();
        $user->forceFill(['status' => UserStatus::Suspended, 'restrictions' => null])->save();
        Sanctum::actingAs($user);

        $this->postJson('/api/v1/test-publish')
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted')
            ->assertJsonPath('until', null);
    });
});

describe('SEC-105 sessions on the API', function () {
    beforeEach(function () {
        config(['session.driver' => 'database']);
        app()->forgetInstance('session.store');

        Route::middleware('api')->get('api/v1/test-session', fn (Request $request) => response()->json(['session' => $request->hasSession()]));
    });

    it('starts no session for an anonymous call from the SPA', function (string $header) {
        $response = $this->withHeader($header, 'http://localhost:8080/app')->getJson('/api/v1/test-session')->assertOk();

        expect($response->json('session'))->toBeFalse()
            ->and($response->headers->getCookies())->toBe([])
            ->and(DB::table('sessions')->count())->toBe(0);
    })->with(['Referer', 'Origin']);

    it('starts none on the public endpoints either', function () {
        $response = $this->withHeader('Referer', 'http://localhost:8080/app')->getJson('/api/v1/app-config')->assertOk();

        expect($response->headers->getCookies())->toBe([])
            ->and(DB::table('sessions')->count())->toBe(0);
    });

    it('keeps the SPA login flow: the cookie route opens the session, later calls use it', function () {
        $name = config()->string('session.cookie');
        $cookie = $this->get('/sanctum/csrf-cookie')->assertNoContent()->getCookie($name, decrypt: false);

        expect($cookie)->not->toBeNull()
            ->and(DB::table('sessions')->count())->toBe(1);

        $this->withCredentials()
            ->withUnencryptedCookie($name, $cookie->getValue())
            ->withHeader('Referer', 'http://localhost:8080/app')
            ->getJson('/api/v1/test-session')
            ->assertOk()
            ->assertJsonPath('session', true);
    });

    it('ignores the session cookie without a first-party origin', function () {
        $this->withCredentials()
            ->withCookie(config()->string('session.cookie'), 'whatever')
            ->withHeader('Referer', 'https://evil.example/')
            ->getJson('/api/v1/test-session')
            ->assertJsonPath('session', false);
    });
});

describe('SEC-106 query exceptions', function () {
    beforeEach(function () {
        config(['database.connections.masked' => [...config('database.connections.mysql'), 'mask_bindings_in_exception_messages' => true]]);
    });

    /**
     * @return array{0: QueryException}
     */
    function failingQuery(string $connection): QueryException
    {
        try {
            DB::connection($connection)->select('select * from not_a_table where email = ?', ['geheim@example.de']);
        } catch (QueryException $exception) {
            return $exception;
        }

        throw new RuntimeException('The query should have failed.');
    }

    it('masks bindings outside local and tests, also in an unknown environment', function (string $environment, bool $masked) {
        $config = configFileUnder('database.php', ['APP_ENV' => $environment]);

        expect($config['connections']['mysql']['mask_bindings_in_exception_messages'])->toBe($masked)
            ->and($config['connections']['mariadb']['mask_bindings_in_exception_messages'])->toBe($masked);
    })->with([
        'production' => ['production', true],
        'staging' => ['staging', true],
        'typo' => ['prod', true],
        'local' => ['local', false],
        'testing' => ['testing', false],
    ]);

    it('keeps the value out of the message of a masked connection', function () {
        expect(failingQuery('masked')->getMessage())->not->toContain('geheim@example.de')->toContain('email = ?');
    });

    it('logs placeholders and the code only', function () {
        Log::spy();

        report(failingQuery('masked'));

        Log::shouldHaveReceived('error')->once()->withArgs(function (string $message, array $context): bool {
            expect(json_encode($context))->not->toContain('geheim')
                ->and($context['sql'])->toContain('email = ?')
                ->and($context['sqlstate'])->toBe('42S02');

            return $message === 'Database query failed.';
        });
    });

    it('leaves the full report to a connection that does not mask', function () {
        config(['database.connections.unmasked' => [...config('database.connections.mysql'), 'mask_bindings_in_exception_messages' => false]]);
        Log::spy();

        report(failingQuery('unmasked'));

        Log::shouldHaveReceived('error')->once()->withArgs(fn (string $message): bool => str_contains($message, 'geheim@example.de'));
    });
});

describe('SEC-108 HTTPS', function () {
    it('trusts only the configured proxy', function (array $proxies, string $from, bool $secure) {
        config(['speedclub.trusted_proxies' => $proxies]);

        $response = $this->withServerVariables(['REMOTE_ADDR' => $from])
            ->withHeader('X-Forwarded-Proto', 'https')
            ->get('/');

        expect($response->headers->has('Strict-Transport-Security'))->toBe($secure);
    })->with([
        'nothing trusted' => [[], '203.0.113.9', false],
        'that proxy' => [['203.0.113.9'], '203.0.113.9', true],
        'that range' => [['203.0.113.0/24'], '203.0.113.9', true],
        'another proxy' => [['203.0.113.1'], '203.0.113.9', false],
        'any proxy' => [['*'], '203.0.113.9', true],
    ]);

    it('takes the member IP from a trusted proxy only', function (array $proxies, string $ip) {
        config(['speedclub.trusted_proxies' => $proxies]);
        Route::get('test-ip', fn (Request $request) => response()->json(['ip' => $request->ip()]));

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
            ->withHeader('X-Forwarded-For', '198.51.100.7')
            ->getJson('/test-ip')
            ->assertJsonPath('ip', $ip);
    })->with([
        'trusted' => [['203.0.113.9'], '198.51.100.7'],
        'not trusted' => [[], '203.0.113.9'],
    ]);

    it('makes the session cookie secure when APP_URL is https, unless it is set', function (array $env, mixed $secure) {
        unset($_ENV['SESSION_SECURE_COOKIE'], $_SERVER['SESSION_SECURE_COOKIE']);

        expect(configFileUnder('session.php', $env)['secure'])->toBe($secure);
    })->with([
        'https' => [['APP_URL' => 'https://speedclub.de'], true],
        'http' => [['APP_URL' => 'http://localhost:8080'], false],
        'set off on https' => [['APP_URL' => 'https://speedclub.de', 'SESSION_SECURE_COOKIE' => 'false'], false],
        'set on on http' => [['APP_URL' => 'http://localhost:8080', 'SESSION_SECURE_COOKIE' => 'true'], true],
    ]);

    describe('the redirect', function () {
        beforeEach(function () {
            app()->detectEnvironment(fn () => 'production');
            config(['app.url' => 'https://speedclub.test', 'speedclub.force_https' => true, 'speedclub.trusted_hosts' => ['localhost']]);
        });

        it('sends plain HTTP to APP_URL, whatever the Host header says', function () {
            $this->withHeader('Host', 'evil.example')->get('http://localhost/impressum?a=1')
                ->assertStatus(301)
                ->assertRedirect('https://speedclub.test/impressum?a=1');
        });

        it('keeps the method of a write', function () {
            $this->post('http://localhost/api/v1/catalog/requests')->assertStatus(308);
        });

        it('cannot loop behind a proxy it does not know', function (string $header, string $value) {
            config(['speedclub.trusted_proxies' => []]);

            expect($this->withHeader($header, $value)->get('http://localhost/')->isRedirection())->toBeFalse();
        })->with([
            ['X-Forwarded-Proto', 'https'],
            ['X-Forwarded-Ssl', 'on'],
            ['Cf-Visitor', '{"scheme":"https"}'],
        ]);

        it('redirects when a trusted proxy reports plain HTTP', function (array $proxies) {
            config(['speedclub.trusted_proxies' => $proxies]);

            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
                ->withHeader('X-Forwarded-Proto', 'http')
                ->get('http://localhost/impressum')
                ->assertStatus(301)
                ->assertRedirect('https://speedclub.test/impressum');
        })->with([
            'that proxy' => [['203.0.113.9']],
            'any proxy' => [['*']],
        ]);

        it('does not redirect when a trusted proxy reports HTTPS', function () {
            config(['speedclub.trusted_proxies' => ['203.0.113.9']]);

            expect($this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
                ->withHeader('X-Forwarded-Proto', 'https')
                ->get('http://localhost/')
                ->isRedirection())->toBeFalse();
        });

        it('does not believe an untrusted sender that reports plain HTTP', function () {
            config(['speedclub.trusted_proxies' => ['203.0.113.1']]);

            expect($this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
                ->withHeader('X-Forwarded-Proto', 'http')
                ->get('http://localhost/')
                ->isRedirection())->toBeFalse();
        });

        it('leaves HTTPS and the health check alone', function () {
            expect($this->get('https://localhost/')->isRedirection())->toBeFalse()
                ->and($this->get('http://localhost/up')->isRedirection())->toBeFalse();
        });

        it('does nothing when switched off, outside production or without an https APP_URL', function (array $config, string $environment) {
            app()->detectEnvironment(fn () => $environment);
            config($config);

            expect($this->get('http://localhost/')->isRedirection())->toBeFalse();
        })->with([
            'off' => [['speedclub.force_https' => false], 'production'],
            'staging' => [[], 'staging'],
            'http site' => [['app.url' => 'http://speedclub.test'], 'production'],
        ]);
    });
});

describe('RejectInvalidText on the staff group', function () {
    it('answers 422 to a browser GET instead of redirecting back to itself', function () {
        $response = $this->get('/admin/login?q=a%00b');

        $response->assertStatus(422);
        expect($response->isRedirection())->toBeFalse();
    });

    it('still redirects a form post back with the error', function () {
        $this->from('/admin/login')->post('/admin/login', ['email' => 'a b'])->assertRedirect('/admin/login');
    });

    it('answers JSON clients and the API with the usual body', function () {
        $this->getJson('/admin/login?q=a%00b')->assertStatus(422);
        $this->getJson('/api/v1/usernames/check?username=a%00b')->assertStatus(422)->assertJsonPath('code', 'validation_failed');
    });
});
