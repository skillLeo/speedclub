<?php

use App\Actions\Admin\Members\EndViewAs;
use App\Actions\Admin\Members\StartViewAs;
use App\Enums\StaffStatus;
use App\Models\AuditEvent;
use App\Models\PersonalAccessToken;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\StaffCredentials;
use App\Services\Qr\QrCodes;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Admin/Actions/Helpers.php';

/**
 * M3.2 §3 view-as: a 30-minute member token with the single ability view-as, read-only on every API route, never messages, no side
 * effects on GET, ended by DELETE api/v1/view-as or by expiry, start and end audited.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->member = User::factory()->create(['username' => 'kai.sti', 'locale' => 'de']);
});

/** @return array{token: string, url: string, expires_at: string, token_id: int} */
function m32ViewAs(User $member, string $role = 'admin', bool $consent = false): array
{
    return app(StartViewAs::class)->handle(m31Staff($role), $member, m32Reason(), $consent);
}

/** Paths whose answers hold messages or message counts (RestrictViewAs::MESSAGE_PATHS, written out again on purpose). */
function m32IsMessageRoute(string $uri): bool
{
    return preg_match('#^api/v1/(conversations|messages|chat-media|broadcasting)(/|$)#', $uri) === 1
        || in_array($uri, ['api/v1/notifications/unread-count', 'api/v1/me/exports', 'api/v1/me/exports/{export}/download', 'api/v1/me/export'], true);
}

/** @return list<LaravelRoute> */
function m32ApiRoutes(): array
{
    return array_values(array_filter(Route::getRoutes()->getRoutes(), fn (LaravelRoute $route): bool => str_starts_with($route->uri(), 'api/v1/')));
}

/** The route's URI with a value for each parameter that its `where` pattern accepts, so the request reaches the route. */
function m32Uri(LaravelRoute $route): string
{
    return '/'.preg_replace_callback('/\{([^}?]+)\??\}/', function (array $match) use ($route): string {
        $pattern = $route->wheres[$match[1]] ?? null;

        foreach (['01JAAAAAAAAAAAAAAAAAAAAAAA', '320', 'tobi.quattro', 'ABCD2345'] as $candidate) {
            if ($pattern === null || preg_match('#\A(?:'.$pattern.')\z#', $candidate) === 1) {
                return $candidate;
            }
        }

        return $match[1];
    }, $route->uri());
}

describe('start', function () {
    it('issues a 30-minute token with only the view-as ability, named after the staff member, audited, the token in the fragment', function () {
        $staff = m31Staff('admin', attributes: ['name' => 'Anna Admin']);
        $started = app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), false);
        $token = PersonalAccessToken::query()->findOrFail($started['token_id']);

        expect($token->abilities)->toBe(['view-as'])
            ->and($token->name)->toBe('view-as:'.$staff->id)
            ->and($token->tokenable_id)->toBe($this->member->id)
            ->and((int) round(now()->diffInMinutes($token->expires_at)))->toBe(30)
            ->and($started['url'])->toContain('/app/#view_as='.rawurlencode($started['token']))
            ->and($started['url'])->toContain('staff=Anna%20Admin')
            ->and($started['url'])->not->toContain('?');

        $event = AuditEvent::query()->where('action', 'member.view_as_started')->sole();
        expect($event->getAttribute('actor_id'))->toBe((string) $staff->id)
            ->and($event->getAttribute('reason'))->toBe(m32Reason())
            ->and($event->after['member_consented'])->toBeFalse();
    });

    it('needs members.view_as, and the member\'s consent from Support', function (string $role, bool $allowed) {
        if (! $allowed) {
            expect(fn () => m32ViewAs($this->member, $role, true))->toThrow(AuthorizationException::class);

            return;
        }

        if ($role === 'support') {
            expect(fn () => m32ViewAs($this->member, $role, false))->toThrow(ValidationException::class);
        }

        expect(m32ViewAs($this->member, $role, true)['token'])->toBeString();
    })->with(m32Matrix('members.view_as'));

    it('refuses a closed account', function () {
        $this->member->forceFill(['deletion_requested_at' => now(), 'status' => 'deactivated'])->save();

        expect(fn () => m32ViewAs($this->member))->toThrow(DomainException::class);
    });
});

describe('API with a view-as token', function () {
    it('reads like the member', function () {
        $token = m32ViewAs($this->member)['token'];

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.username', 'kai.sti');
        $this->withToken($token)->getJson('/api/v1/me/vehicles')->assertOk();
    });

    it('answers every write with view_as_read_only and every message route with view_as_no_messages, on every api/v1 route', function () {
        $token = m32ViewAs($this->member)['token'];
        $checked = ['read_only' => 0, 'no_messages' => 0];

        foreach (m32ApiRoutes() as $route) {
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                if ($method === 'DELETE' && $route->uri() === 'api/v1/view-as') {
                    continue;
                }

                $message = m32IsMessageRoute($route->uri());

                if ($method === 'GET' && ! $message) {
                    continue;
                }

                $this->app['auth']->forgetGuards();
                $response = $this->withToken($token)->json($method, m32Uri($route));
                $code = $message ? 'view_as_no_messages' : 'view_as_read_only';

                expect($response->status())->toBe(403, "$method {$route->uri()} answered {$response->status()}")
                    ->and($response->json('code'))->toBe($code, "$method {$route->uri()}");
                $checked[$message ? 'no_messages' : 'read_only']++;
            }
        }

        expect($checked['read_only'])->toBeGreaterThan(50)
            ->and($checked['no_messages'])->toBeGreaterThan(12)
            ->and($this->member->refresh()->tokens()->count())->toBe(1);
    });

    it('still refuses writes when the token has expired', function () {
        $token = m32ViewAs($this->member)['token'];
        $this->travel(31)->minutes();

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertForbidden()->assertJsonPath('code', 'view_as_read_only');
    });

    it('leaves no trace on GET: no last_seen_at, no activity counters, no QR scan, no reset code', function () {
        $token = m32ViewAs($this->member)['token'];
        $other = User::factory()->create();
        $qr = app(QrCodes::class)->ensureActive(modVehicle($other));
        $days = DB::table('activity_days')->count();

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();
        $this->withToken($token)->getJson('/api/v1/qr/'.$qr->code)->assertOk();

        expect($this->member->refresh()->getAttribute('last_seen_at'))->toBeNull()
            ->and(DB::table('activity_days')->count())->toBe($days)
            ->and(QrScanDaily::query()->count())->toBe(0);

        // The same GET with the member's own token does count: the guard is about view-as only.
        $this->app['auth']->forgetGuards();
        $this->withToken($other->createToken('phone', ['member'])->plainTextToken)->getJson('/api/v1/qr/'.$qr->code)->assertOk();
        expect(QrScanDaily::query()->count())->toBe(0);

        $this->app['auth']->forgetGuards();
        $this->withToken($this->member->createToken('phone', ['member'])->plainTextToken)->getJson('/api/v1/qr/'.$qr->code)->assertOk();
        expect(QrScanDaily::query()->count())->toBe(1);

        $this->member->forceFill(['force_password_change' => true])->save();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden()->assertJsonPath('code', 'password_change_required');
        expect(VerificationCode::query()->where('user_id', $this->member->id)->count())->toBe(0);
    });
});

describe('end', function () {
    it('ends with DELETE api/v1/view-as, audited with the staff member as actor', function () {
        $staff = m31Staff('admin');
        $token = app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), true)['token'];

        $this->withToken($token)->deleteJson('/api/v1/view-as')->assertNoContent();

        expect($this->member->tokens()->count())->toBe(0);
        $event = AuditEvent::query()->where('action', 'member.view_as_ended')->sole();
        expect($event->getAttribute('actor_id'))->toBe((string) $staff->id)
            ->and($event->getAttribute('actor_type')->value)->toBe('staff');

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->deleteJson('/api/v1/view-as')->assertUnauthorized();
    });

    it('is no way out for a member token, and staff can end their own view-as', function () {
        $memberToken = $this->member->createToken('phone', ['member'])->plainTextToken;
        $this->withToken($memberToken)->deleteJson('/api/v1/view-as')->assertForbidden()->assertJsonPath('code', 'forbidden');

        $staff = m31Staff('support');
        app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), true);

        expect(app(EndViewAs::class)->byStaff($staff, $this->member))->toBe(1)
            ->and($this->member->tokens()->count())->toBe(1);
    });

    it('replaces an earlier view-as of the same staff member', function () {
        $staff = m31Staff('admin');
        app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), false);
        app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), false);

        expect($this->member->tokens()->count())->toBe(1);
    });
});

describe('SEC-P3-07: a view-as does not outlive its staff member', function () {
    it('answers 401 once the staff member who started it is suspended or deactivated', function (StaffStatus $status) {
        $staff = m31Staff('admin');
        $token = app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), false)['token'];

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

        $staff->forceFill(['status' => $status])->save();
        app('auth')->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
        $this->withToken($token)->getJson('/api/v1/me/settings')->assertUnauthorized();
    })->with([StaffStatus::Suspended, StaffStatus::Deactivated]);

    it('ends every view-as the staff member started when their credentials change, audited', function () {
        $staff = m31Staff('admin');
        $second = User::factory()->create();
        app(StartViewAs::class)->handle($staff, $this->member, m32Reason(), false);
        app(StartViewAs::class)->handle($staff, $second, m32Reason(), false);
        $colleague = app(StartViewAs::class)->handle(m31Staff('admin'), $this->member, m32Reason(), false);

        StaffCredentials::rotate($staff);

        expect(PersonalAccessToken::query()->where('name', 'view-as:'.$staff->id)->count())->toBe(0)
            ->and(PersonalAccessToken::query()->whereKey($colleague['token_id'])->exists())->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'member.view_as_ended')->get()->pluck('after.ended_by')->all())->toBe(['staff_credentials_changed', 'staff_credentials_changed']);
    });
});
