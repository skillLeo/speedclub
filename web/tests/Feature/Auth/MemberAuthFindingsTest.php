<?php

use App\Actions\Auth\RegisterMember;
use App\Actions\Auth\ResetMemberPassword;
use App\Actions\Auth\RotateMemberToken;
use App\Actions\Fortify\ResetStaffPassword;
use App\Actions\Fortify\UpdateStaffPassword;
use App\Actions\Me\ChangeUsername;
use App\Actions\Me\ReplaceProfileImage;
use App\Enums\MemberSecurityEvent;
use App\Enums\ProfileImageSlot;
use App\Enums\VerificationPurpose;
use App\Exceptions\ApiException;
use App\Mail\AccountClosingMail;
use App\Mail\AccountExistsMail;
use App\Mail\PasswordResetCodeMail;
use App\Models\AuditEvent;
use App\Models\Follow;
use App\Models\Media;
use App\Models\PersonalAccessToken;
use App\Models\Save;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Auth\VerificationCodes;
use App\Support\Username;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Tests\Support\TestImages;

const FINDINGS_PASSWORD = 'Lackierung-92-rot';

beforeEach(function () {
    Mail::fake();
});

function liveToken(User $member): string
{
    return $member->createToken('Pixel 9')->plainTextToken;
}

function findingsImage(): UploadedFile
{
    return UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300));
}

function findingsWrongCode(string $code): string
{
    return $code === '000000' ? '000001' : '000000';
}

/**
 * Ten codes, an hour apart, so only the daily cap can stop the eleventh.
 */
function spendDailyCodes(User $member, VerificationPurpose $purpose, bool $burn = false): void
{
    $codes = app(VerificationCodes::class);

    foreach (range(1, 10) as $number) {
        $code = $codes->issue($member, $purpose);

        expect($code)->toBeString();

        if ($burn) {
            foreach (range(1, 5) as $guess) {
                expect($codes->consume($member, $purpose, findingsWrongCode($code), fn () => null))->toBeFalse();
            }

            expect($codes->consume($member, $purpose, $code, fn () => null))->toBeFalse();
        }

        test()->travel(61)->minutes();
    }
}

/**
 * @return array<string, array{0: string}>
 */
function hashShapedPasswords(): array
{
    return [
        'bcrypt' => [password_hash('anything', PASSWORD_BCRYPT, ['cost' => 4])],
        'argon2id' => ['$argon2id$v=19$m=65536,t=4,p=1$c29tZXNhbHQxMjM0NTY$'.str_repeat('A', 43)],
    ];
}

describe('force_password_change holds beyond login', function () {
    it('does not let auth/email/verify sign in a flagged member', function () {
        $member = User::factory()->unverified()->create(['email' => 'pflicht@example.de', 'password' => FINDINGS_PASSWORD, 'force_password_change' => true]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'pflicht@example.de', 'code' => $code, 'password' => FINDINGS_PASSWORD, 'device_name' => 'Pixel 9'])
            ->assertForbidden()
            ->assertJsonPath('code', 'password_change_required')
            ->assertJsonPath('next', 'reset_password')
            ->assertJsonPath('email', 'pflicht@example.de');

        expect($member->tokens()->count())->toBe(0)
            ->and($member->refresh()->hasVerifiedEmail())->toBeTrue()
            ->and($member->force_password_change)->toBeTrue();

        Mail::assertSent(PasswordResetCodeMail::class, 1);
    });

    it('stops an earlier token on every authenticated route', function (string $method, Closure $path) {
        $member = User::factory()->create(['email' => 'pflicht@example.de']);
        $token = liveToken($member);
        $url = $path($member);
        $member->forceFill(['force_password_change' => true])->save();

        $this->withToken($token)->json($method, $url)
            ->assertForbidden()
            ->assertJsonPath('code', 'password_change_required')
            ->assertJsonPath('next', 'reset_password')
            ->assertJsonPath('email', 'pflicht@example.de');
    })->with([
        'auth/me' => ['GET', fn () => '/api/v1/auth/me'],
        'rotate' => ['POST', fn () => '/api/v1/auth/token/rotate'],
        'profile' => ['GET', fn () => '/api/v1/me/profile'],
        'settings' => ['PATCH', fn () => '/api/v1/me/settings'],
        'username' => ['PUT', fn () => '/api/v1/me/username'],
        'avatar' => ['POST', fn () => '/api/v1/me/avatar'],
        'catalog request' => ['POST', fn () => '/api/v1/catalog/requests'],
        'vehicle photo' => ['POST', fn (User $member) => '/api/v1/vehicles/'.Vehicle::factory()->create(['owner_id' => $member->id])->id.'/media'],
        'photo delete' => ['DELETE', fn (User $member) => '/api/v1/media/'.Media::factory()->create(['owner_id' => $member->id])->id],
    ]);

    it('stops an earlier browser session too', function () {
        $member = User::factory()->create();
        $session = databaseSessionFor($member, 'web');
        $member->forceFill(['force_password_change' => true])->save();

        $this->withCredentials()
            ->withCookie(config()->string('session.cookie'), $session)
            ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
            ->getJson('/api/v1/auth/me')
            ->assertForbidden()
            ->assertJsonPath('code', 'password_change_required');
    });

    it('sends one code to a running client, not one per request', function () {
        $member = User::factory()->create();
        $token = liveToken($member);
        $member->forceFill(['force_password_change' => true])->save();

        foreach (range(1, 3) as $request) {
            $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();
        }

        Mail::assertSent(PasswordResetCodeMail::class, 1);

        $this->travel(2)->hours();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();

        Mail::assertSent(PasswordResetCodeMail::class, 2);
    });

    it('does not replace the code the member is about to type', function () {
        $member = User::factory()->create(['email' => 'pflicht@example.de', 'password' => FINDINGS_PASSWORD]);
        $token = liveToken($member);
        $member->forceFill(['force_password_change' => true])->save();

        $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => FINDINGS_PASSWORD, 'device_name' => 'P'])->assertForbidden();
        $code = Mail::sent(PasswordResetCodeMail::class)->last()->code;

        $this->travel(2)->minutes();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();

        Mail::assertSent(PasswordResetCodeMail::class, 1);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'pflicht@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();
    });

    it('keeps logout and the reset flow open', function () {
        $member = User::factory()->create(['email' => 'pflicht@example.de']);
        $token = liveToken($member);
        $member->forceFill(['force_password_change' => true])->save();

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'pflicht@example.de'])->assertStatus(202);
        $code = Mail::sent(PasswordResetCodeMail::class)->last()->code;

        $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();

        expect($member->tokens()->count())->toBe(0);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'pflicht@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();

        expect($member->refresh()->force_password_change)->toBeFalse();
    });

    it('lets everybody else through', function () {
        $this->withToken(liveToken(User::factory()->create()))->getJson('/api/v1/auth/me')->assertOk();
    });

    it('has logout as the only member route outside the guard, so a new route cannot forget it', function () {
        $unguarded = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with((string) $route->getName(), 'api.v1.') && in_array('auth:sanctum', $route->gatherMiddleware(), true))
            ->map(fn ($route) => $route->getName())
            ->values()
            ->all();

        expect($unguarded)->toBe(['api.v1.auth.logout']);
    });
});

describe('dates inside translated messages', function () {
    it('names the moment in Berlin for a username cooldown', function (string $locale, string $expected) {
        // 23:30 UTC on New Year's Eve is already next year in Germany: the UTC date is a day on which the member is refused.
        $until = CarbonImmutable::parse('2026-12-31T23:30:00Z');
        $this->travelTo($until->subDay());

        $member = User::factory()->create(['username' => 'vorher.name', 'username_changed_at' => $until->subDays(30)]);

        $this->withToken(liveToken($member))
            ->withHeader('Accept-Language', $locale)
            ->putJson('/api/v1/me/username', ['username' => 'nachher.name'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'username_change_cooldown')
            ->assertJsonPath('until', $until->toIso8601String())
            ->assertJsonPath('message', $expected);
    })->with([
        'de' => ['de', 'Du kannst deinen Benutzernamen ab dem 01.01.2027, 00:30 Uhr wieder ändern.'],
        'en' => ['en', 'You can change your username again from 1 Jan 2027, 00:30.'],
    ]);

    it('follows daylight saving time for a restriction', function () {
        app()->setLocale('de');

        expect(ApiException::accountRestricted(CarbonImmutable::parse('2027-06-30T22:30:00Z'))->getMessage())
            ->toBe('Dein Konto ist für diese Aktion bis zum 01.07.2027, 00:30 Uhr eingeschränkt.');
    });
});

it('ends the login delay with a successful password reset', function () {
    $member = User::factory()->create(['email' => 'vergessen@example.de', 'password' => FINDINGS_PASSWORD]);

    foreach (range(1, 5) as $attempt) {
        $this->postJson('/api/v1/auth/login', ['email' => 'vergessen@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
    }

    $this->postJson('/api/v1/auth/login', ['email' => 'vergessen@example.de', 'password' => FINDINGS_PASSWORD, 'device_name' => 'P'])->assertStatus(429);

    $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);
    $this->postJson('/api/v1/auth/password/reset', ['email' => 'vergessen@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();

    $this->postJson('/api/v1/auth/login', ['email' => 'vergessen@example.de', 'password' => 'Neues-Passwort-77', 'device_name' => 'P'])->assertOk();
});

it('keeps the counts in the member.logout_all audit event', function () {
    $member = User::factory()->create(['email' => 'zaehlen@example.de']);
    liveToken($member);
    $member->createToken('iPad');

    $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);
    $this->postJson('/api/v1/auth/password/reset', ['email' => 'zaehlen@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();

    expect(AuditEvent::query()->where('action', MemberSecurityEvent::LogoutAll->value)->sole()->after)
        ->toBe(['devices' => 2, 'sessions' => 0]);
});

describe('the second writer of a race', function () {
    it('applies the username cooldown the first writer started', function () {
        $member = User::factory()->create(['username' => 'erster.name']);
        $stale = User::query()->findOrFail($member->id);

        app(ChangeUsername::class)->handle($member, 'zweiter.name');

        $thrown = null;

        try {
            app(ChangeUsername::class)->handle($stale, 'dritter.name');
        } catch (ApiException $exception) {
            $thrown = $exception->errorCode->value;
        }

        expect($thrown)->toBe('username_change_cooldown')
            ->and($member->refresh()->username)->toBe('zweiter.name')
            ->and($member->previous_username)->toBe('erster.name');
    });

    it('records the first writer\'s choice as the old name', function () {
        $member = User::factory()->create(['username' => null]);
        $stale = User::query()->findOrFail($member->id);

        app(ChangeUsername::class)->handle($member, 'erster.name');
        app(ChangeUsername::class)->handle($stale, 'zweiter.name');

        expect($member->refresh()->username)->toBe('zweiter.name')
            ->and($member->previous_username)->toBe('erster.name')
            ->and($member->username_changed_at)->not->toBeNull();
    });

    it('rotates one token once: a repeat replaces the unused new token, and leaves one new token', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Pixel 9')->accessToken;
        $this->travel(8)->days();

        $first = app(RotateMemberToken::class)->handle(User::query()->findOrFail($member->id)->withAccessToken($token));
        $second = app(RotateMemberToken::class)->handle(User::query()->findOrFail($member->id)->withAccessToken($token));

        expect(PersonalAccessToken::findToken($first->token))->toBeNull()
            ->and(PersonalAccessToken::findToken($second->token))->not->toBeNull()
            // The replaced one, in its grace period (BH-36, tests/Feature/Auth/BugHuntAuthTest.php), and the new one.
            ->and(PersonalAccessToken::query()->where('tokenable_id', $member->id)->count())->toBe(2);
    });

    it('rotates one token once: a repeat after the new token was used is refused and ends the old token', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Pixel 9')->accessToken;
        $this->travel(8)->days();

        $first = app(RotateMemberToken::class)->handle(User::query()->findOrFail($member->id)->withAccessToken($token));
        PersonalAccessToken::findToken($first->token)->forceFill(['last_used_at' => now()])->save();

        $thrown = null;

        try {
            app(RotateMemberToken::class)->handle(User::query()->findOrFail($member->id)->withAccessToken($token));
        } catch (ApiException $exception) {
            $thrown = $exception->errorCode->value;
        }

        expect($thrown)->toBe('conflict')
            ->and(PersonalAccessToken::query()->where('tokenable_id', $member->id)->count())->toBe(1)
            ->and(PersonalAccessToken::findToken($first->token))->not->toBeNull();
    });

    it('checks the state of the account again under the lock', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Pixel 9')->accessToken;
        $this->travel(8)->days();
        $stale = User::query()->findOrFail($member->id)->withAccessToken($token);

        $member->forceFill(['force_password_change' => true])->save();

        expect(fn () => app(RotateMemberToken::class)->handle($stale))->toThrow(ApiException::class);
        expect(PersonalAccessToken::query()->whereKey($token->id)->exists())->toBeTrue();
    });

    it('leaves no public image without a pointer after parallel uploads', function (string $slot, ProfileImageSlot $image) {
        Storage::fake('public');
        Storage::fake('local');
        $action = app(ReplaceProfileImage::class);

        $member = User::factory()->create();
        $action->handle($member, findingsImage(), $image);
        $first = $member->refresh()->getAttribute($image->value);

        // Both requests read the same row, then one wins the lock.
        $stale = User::query()->findOrFail($member->id);
        $winner = $action->handle(User::query()->findOrFail($member->id), findingsImage(), $image)->getAttribute($image->value);
        $last = $action->handle($stale, findingsImage(), $image)->getAttribute($image->value);

        $live = Media::query()->where('owner_id', $member->id)->pluck('id')->all();

        expect($member->refresh()->getAttribute($image->value))->toBe($last)
            ->and($live)->toBe([$last])
            ->and(Media::withTrashed()->findOrFail($winner)->variants)->toBeNull()
            ->and(Media::withTrashed()->findOrFail($first)->variants)->toBeNull()
            ->and(Media::query()->findOrFail($last)->variants)->not->toBeNull();
    })->with([
        'avatar' => ['avatar', ProfileImageSlot::Avatar],
        'cover' => ['cover', ProfileImageSlot::Cover],
    ]);

    it('moves the pointer and deletes the old image as one step', function () {
        Storage::fake('public');
        Storage::fake('local');
        $action = app(ReplaceProfileImage::class);

        $member = User::factory()->create();
        $action->handle($member, findingsImage(), ProfileImageSlot::Avatar);
        $old = $member->refresh()->avatar_media_id;

        Media::deleting(function (Media $media) use ($old): void {
            if ($media->id === $old) {
                throw new RuntimeException('The delete failed.');
            }
        });

        expect(fn () => $action->handle(User::query()->findOrFail($member->id), findingsImage(), ProfileImageSlot::Avatar))
            ->toThrow(RuntimeException::class);

        $current = Media::query()->findOrFail($old);

        expect($member->refresh()->avatar_media_id)->toBe($old)
            ->and($current->variants)->not->toBeNull()
            ->and(Media::query()->where('owner_id', $member->id)->pluck('id')->all())->toBe([$old]);
    });
});

describe('registering with an address in its deletion window', function () {
    it('explains what happens to the address, in the same neutral answer', function (Closure $state, string $locale, string $text) {
        $state(User::factory()->create(['email' => 'weg@example.de', 'locale' => $locale]));

        $this->postJson('/api/v1/auth/register', ['email' => 'weg@example.de', 'password' => FINDINGS_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])
            ->assertStatus(202)
            ->assertExactJson(['data' => ['next' => 'verify_email', 'email' => 'weg@example.de', 'resend_after_seconds' => 60]]);

        Mail::assertNotSent(AccountExistsMail::class);
        Mail::assertSent(AccountClosingMail::class, 1);

        app()->setLocale($locale);
        $html = Mail::sent(AccountClosingMail::class)->first()->render();

        expect($html)->toContain($text)->not->toContain('forgot-password')->not->toContain('sign-in');
    })->with([
        'deactivated, de' => [fn (User $member) => $member->forceFill(['status' => 'deactivated'])->save(), 'de', 'innerhalb von 30 Tagen'],
        'deactivated, en' => [fn (User $member) => $member->forceFill(['status' => 'deactivated'])->save(), 'en', 'within 30 days'],
        'soft deleted' => [fn (User $member) => $member->delete(), 'de', 'wieder frei'],
    ]);

    it('still sends sign-in and reset to an active account', function () {
        User::factory()->create(['email' => 'da@example.de']);

        $this->postJson('/api/v1/auth/register', ['email' => 'da@example.de', 'password' => FINDINGS_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])->assertStatus(202);

        Mail::assertSent(AccountExistsMail::class, 1);
        Mail::assertNotSent(AccountClosingMail::class);
    });
});

describe('an unverified account has no public side', function () {
    it('is not visible to anybody else', function () {
        $member = User::factory()->unverified()->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);

        expect($member->isPubliclyVisible())->toBeFalse()
            ->and(Gate::forUser(null)->allows('view', $member))->toBeFalse()
            ->and(Gate::forUser(User::factory()->create())->allows('view', $member))->toBeFalse()
            ->and(Gate::forUser(null)->allows('view', $vehicle))->toBeFalse()
            ->and(Gate::forUser($member)->allows('view', $member))->toBeTrue();
    });

    it('becomes visible once the address is proven', function () {
        $member = User::factory()->unverified()->create();
        $member->forceFill(['email_verified_at' => now()])->save();

        expect(Gate::forUser(null)->allows('view', $member))->toBeTrue();
    });

    it('can still browse and save, as the spec lists only publish, follow and message', function () {
        $viewer = User::factory()->unverified()->create();
        $vehicle = Vehicle::factory()->published()->create();

        expect(Gate::forUser($viewer)->allows('view', $vehicle))->toBeTrue()
            ->and(Gate::forUser($viewer)->allows('create', [Save::class, $vehicle]))->toBeTrue();
    });
});

describe('email_not_verified from policies', function () {
    it('names the reason when publish is refused for it', function () {
        $member = User::factory()->unverified()->create();
        $vehicle = Vehicle::factory()->create(['owner_id' => $member->id]);

        Route::middleware(['api', 'member'])->post('api/v1/test-publish/{vehicle}', function (Vehicle $vehicle) {
            Gate::authorize('publish', $vehicle);

            return response()->noContent();
        });

        $this->withToken(liveToken($member))
            ->withHeader('Accept-Language', 'de')
            ->postJson("/api/v1/test-publish/{$vehicle->id}")
            ->assertForbidden()
            ->assertJsonPath('code', 'email_not_verified')
            ->assertJsonPath('message', 'Bestätige zuerst deine E-Mail-Adresse.');
    });

    it('stays a plain forbidden for anybody but the owner', function () {
        $vehicle = Vehicle::factory()->create();
        $other = User::factory()->unverified()->create();

        Route::middleware(['api', 'member'])->post('api/v1/test-publish/{vehicle}', function (Vehicle $vehicle) {
            Gate::authorize('publish', $vehicle);

            return response()->noContent();
        });

        $this->withToken(liveToken($other))->postJson("/api/v1/test-publish/{$vehicle->id}")
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    });

    it('names the reason when a follow is refused for it', function () {
        $member = User::factory()->unverified()->create();
        $target = User::factory()->create();

        expect(Gate::forUser($member)->inspect('create', [Follow::class, $target])->code())->toBe('email_not_verified')
            ->and(Gate::forUser($member)->allows('create', [Follow::class, $target]))->toBeFalse();
    });

    it('holds new publish, follow and message routes to the rule', function () {
        $missing = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route) => preg_match('/\Aapi\.v1\.(.*\.publish|(follows|conversations|messages)\..*)\z/', (string) $route->getName()) === 1)
            ->reject(fn ($route) => in_array('GET', $route->methods(), true))
            ->reject(fn ($route) => in_array('verified-member', $route->gatherMiddleware(), true))
            ->map(fn ($route) => $route->getName())
            ->values()
            ->all();

        expect($missing)->toBe([])
            ->and(in_array('verified-member', Route::getRoutes()->getByName('api.v1.follows.store')->gatherMiddleware(), true))->toBeTrue()
            ->and(in_array('verified-member', Route::getRoutes()->getByName('api.v1.follows.destroy')->gatherMiddleware(), true))->toBeTrue()
            ->and(in_array('verified-member', Route::getRoutes()->getByName('api.v1.vehicles.publish')->gatherMiddleware(), true))->toBeTrue();
    });
});

describe('a password shaped like a hash', function () {
    it('is refused at registration', function (string $password) {
        $this->postJson('/api/v1/auth/register', ['email' => 'neu@example.de', 'password' => $password, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('password');

        expect(User::query()->where('email', 'neu@example.de')->exists())->toBeFalse();
    })->with(hashShapedPasswords());

    it('is refused at reset', function (string $password) {
        $member = User::factory()->create(['email' => 'da@example.de', 'password' => FINDINGS_PASSWORD]);
        $before = $member->getAuthPassword();
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'da@example.de', 'code' => $code, 'password' => $password])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('password');

        expect($member->refresh()->getAuthPassword())->toBe($before);
    })->with(hashShapedPasswords());

    it('is refused at a change, the staff form being the one that exists so far', function (string $password) {
        $staff = Staff::factory()->create();
        $before = $staff->getAuthPassword();
        $this->actingAs($staff, 'staff');

        expect(fn () => app(UpdateStaffPassword::class)->update($staff, ['current_password' => 'password-for-tests', 'password' => $password, 'password_confirmation' => $password]))
            ->toThrow(ValidationException::class)
            ->and(fn () => app(ResetStaffPassword::class)->reset($staff, ['password' => $password, 'password_confirmation' => $password]))
            ->toThrow(ValidationException::class)
            ->and($staff->refresh()->getAuthPassword())->toBe($before);
    })->with(hashShapedPasswords());

    it('is hashed by the reset action, whatever got past validation', function (string $password) {
        $member = User::factory()->create(['email' => 'da@example.de']);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);

        app(ResetMemberPassword::class)->handle('da@example.de', $code, $password);

        $stored = $member->refresh()->getAuthPassword();

        expect($stored)->not->toBe($password)
            ->and(Hash::check($password, $stored))->toBeTrue();
    })->with(hashShapedPasswords());

    it('is hashed by the register action, whatever got past validation', function (string $password) {
        app(RegisterMember::class)->handle(['email' => 'neu@example.de', 'password' => $password]);

        $stored = User::query()->where('email', 'neu@example.de')->sole()->getAuthPassword();

        expect($stored)->not->toBe($password)
            ->and(Hash::check($password, $stored))->toBeTrue();
    })->with(hashShapedPasswords());

    it('is hashed by the rehash at login, for an old account that has one', function (string $password) {
        $member = User::factory()->create(['email' => 'alt@example.de']);
        DB::table('users')->where('id', $member->id)->update(['password' => Hash::make($password, ['memory' => 2048, 'time' => 2, 'threads' => 1])]);

        $this->postJson('/api/v1/auth/login', ['email' => 'alt@example.de', 'password' => $password, 'device_name' => 'P'])->assertOk();

        $stored = $member->refresh()->getAuthPassword();

        expect($stored)->not->toBe($password)
            ->and(Hash::check($password, $stored))->toBeTrue();
    })->with(hashShapedPasswords());

    it('does not catch a normal password with a dollar sign', function () {
        $this->postJson('/api/v1/auth/register', ['email' => 'neu@example.de', 'password' => '$2-Lackierung-rot', 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])
            ->assertStatus(202);
    });
});

describe('usernames that only look like a reserved one', function () {
    it('refuses them', function (string $username) {
        expect(Username::isReserved($username))->toBeTrue()
            ->and(Username::violations($username))->toContain(Username::VIOLATION_RESERVED);
    })->with([
        'adm1n', 'ADM1N', 'supp0rt', '5upport', 'speed.club', 'speed_club', 'sp33dclub', 'spe3d.c1ub', 'r00t', 'l0g1n', '1ogin',
        'he1p', 'h3lp', 'hi1fe', 's.u.p.p.o.r.t', '0ff1c1a1', 'nu11', 'a.p.p', 'sett1ngs', '5y5t3m', 'st.aff',
    ]);

    it('leaves real names alone', function (string $username) {
        expect(Username::isReserved($username))->toBeFalse()
            ->and(Username::isValid($username))->toBeTrue();
    })->with([
        'lukas.sc', 'jann.ptrs', 'max.e46', 'kenji.r34', 'nico.sti', 'adm1n2', 'speedclub1', 'support.team', 'tobi_quattro',
    ]);

    it('answers reserved on the check endpoint', function () {
        $this->getJson('/api/v1/usernames/check?username=adm1n')->assertOk()->assertJsonPath('data.reason', 'reserved');
    });

    it('refuses them on the username endpoint', function () {
        $member = User::factory()->create(['username' => null]);

        $this->withToken(liveToken($member))->putJson('/api/v1/me/username', ['username' => 'supp0rt'])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('username');

        expect($member->refresh()->username)->toBeNull();
    });
});

describe('the long-term budget for code guesses', function () {
    it('caps the codes per account at ten in a rolling 24 hours', function () {
        $member = User::factory()->create();
        $codes = app(VerificationCodes::class);

        spendDailyCodes($member, VerificationPurpose::PasswordReset);

        expect($codes->issue($member, VerificationPurpose::PasswordReset))->toBeNull();

        // Pruning must not refund the budget.
        Artisan::call('speedclub:prune-platform');

        expect($codes->issue($member, VerificationPurpose::PasswordReset))->toBeNull();

        // The first code was issued 10 × 61 minutes ago.
        $this->travel(24 * 60 - 10 * 61 + 1)->minutes();

        expect($codes->issue($member, VerificationPurpose::PasswordReset))->toBeString();
    });

    it('keeps one purpose from spending the other, and one account from spending another', function () {
        $member = User::factory()->create();

        spendDailyCodes($member, VerificationPurpose::PasswordReset);

        $codes = app(VerificationCodes::class);

        expect($codes->issue($member, VerificationPurpose::EmailVerification))->toBeString()
            ->and($codes->issue(User::factory()->create(), VerificationPurpose::PasswordReset))->toBeString();
    });

    it('never locks the owner out of signing in with the password', function () {
        $member = User::factory()->create(['email' => 'ziel@example.de', 'password' => FINDINGS_PASSWORD]);

        spendDailyCodes($member, VerificationPurpose::PasswordReset, burn: true);

        // The stranger is out of budget, and the neutral answer stays.
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'ziel@example.de'])->assertStatus(202);
        Mail::assertNotSent(PasswordResetCodeMail::class);

        $this->postJson('/api/v1/auth/login', ['email' => 'ziel@example.de', 'password' => FINDINGS_PASSWORD, 'device_name' => 'P'])
            ->assertOk()
            ->assertJsonPath('data.member.email', 'ziel@example.de');
    });
});

it('warns without a way to finish the response first', function () {
    config(['speedclub.doctor.response_flush_functions' => ['no_such_function_a', 'no_such_function_b']]);

    expect(Artisan::call('speedclub:doctor'))->toBe(0)
        ->and(preg_replace('/\s+/', ' ', Artisan::output()))
        ->toContain('Neither no_such_function_a nor no_such_function_b')
        ->toContain('forgot and resend can reveal known addresses');
});

it('is content with either function', function () {
    config(['speedclub.doctor.response_flush_functions' => ['no_such_function_a', 'strlen']]);

    expect(Artisan::call('speedclub:doctor'))->toBe(0)
        ->and(preg_replace('/\s+/', ' ', Artisan::output()))
        ->toContain('strlen available')
        ->not->toContain('forgot and resend can reveal');
});
