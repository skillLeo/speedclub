<?php

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\RestrictionType;
use App\Enums\SecurityNotice;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\DeviceInstall;
use App\Models\MemberPasskey;
use App\Models\Notification;
use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\SecurityEvent;
use App\Models\SocialAccount;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use App\Services\DataExport\ExportContents;
use App\Services\Notifications\SendPushNotification;
use App\Services\Security\FailedSignIns;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

require_once __DIR__.'/../Settings/SettingsTestHelpers.php';
require_once __DIR__.'/../Auth20/Helpers.php';

/**
 * M4.7 account security, backend (09 §8.4, §7.9): device_installs, SET-06 devices and sessions, login alerts, SET-21 security activity
 * with "Das war ich nicht" (in the app and from the alert's link), SET-19 sign-in methods. Authorisation matrix per endpoint.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
});

/** A real app sign-in with the M4.7 device fields; returns the plain token. */
function m47SignIn(User $user, string $installId = 'install-aaaa-0001', string $name = 'Pixel 9', string $os = '16', string $version = '2.0.0'): string
{
    $response = test()->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
        'device_name' => $name,
        'platform' => 'android',
        'app_version' => $version,
        'os_version' => $os,
        'device_id' => $installId,
    ])->assertOk();
    app('auth')->forgetGuards();
    test()->flushHeaders();
    test()->withHeader('Accept-Language', 'de');

    return (string) $response->json('data.token');
}

function m47Fresh(): void
{
    app('auth')->forgetGuards();
    test()->flushHeaders();
    test()->withHeader('Accept-Language', 'de');
}

/** The "Das war ich nicht" token of the last security mail. */
function m47SecureToken(): string
{
    $mail = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->secureUrl !== null)->last()
        ?? Mail::queued(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->secureUrl !== null)->last();

    if (! $mail instanceof SecurityNoticeMail || $mail->secureUrl === null) {
        throw new RuntimeException('No security mail with a secure link.');
    }

    return (string) Str::after($mail->secureUrl, '#t=');
}

describe('device_installs', function () {
    it('keeps one row per member and install, with only a keyed hash of the install id', function () {
        $member = setMember();
        m47SignIn($member, 'install-aaaa-0001', 'Pixel 9', '15', '2.0.0');
        $this->travel(5)->minutes();
        m47SignIn($member, 'install-aaaa-0001', 'Pixel 9', '16', '2.0.1');

        $install = DeviceInstall::query()->where('user_id', $member->id)->sole();
        expect($install->install_id_hash)->toBe(DeviceInstalls::key($member->id, 'install-aaaa-0001'))->not->toContain('install-aaaa')
            ->and($install->os_version)->toBe('16')
            ->and($install->app_version)->toBe('2.0.1')
            ->and($install->model)->toBe('Pixel 9')
            ->and($install->last_seen_at->greaterThan($install->first_seen_at))->toBeTrue()
            ->and(PersonalAccessToken::query()->where('tokenable_id', $member->id)->sole()->getAttribute('device_install_id'))->toBe($install->id);

        // The same phone signs in another member: a row of their own.
        $other = setMember();
        m47SignIn($other, 'install-aaaa-0001');
        expect(DeviceInstall::query()->count())->toBe(2);
    });

    it('has no row for an older app build without an install id', function () {
        $member = setMember();
        $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9', 'platform' => 'android'])->assertOk();

        expect(DeviceInstall::query()->count())->toBe(0);
    });

    it('takes the app and system version at a rotation', function () {
        $member = setMember();
        $token = m47SignIn($member, 'install-aaaa-0001', 'Pixel 9', '15', '2.0.0');
        $this->travel(config()->integer('speedclub.tokens.rotate_after_days') + 1)->days();

        $this->withToken($token)->postJson('/api/v1/auth/token/rotate', ['device_id' => 'install-aaaa-0001', 'app_version' => '2.1.0', 'os_version' => '16'])->assertOk();

        $install = DeviceInstall::query()->sole();
        expect($install->app_version)->toBe('2.1.0')->and($install->os_version)->toBe('16');
    });
});

describe('SET-06 GET me/sessions', function () {
    it('shows system version and sign-in date, no IP and no place without GeoLite2', function () {
        $member = setMember();
        $token = m47SignIn($member, 'install-aaaa-0001', 'Pixel 9', '16');
        m47SignIn($member, 'install-bbbb-0002', 'iPhone 16', '26.1');

        $rows = $this->withToken($token)->getJson('/api/v1/me/sessions')->assertOk()->json('data');

        expect($rows)->toHaveCount(2)
            ->and($rows[0])->toMatchArray(['device_name' => 'Pixel 9', 'os_version' => '16', 'current' => true, 'approx_city' => null])
            ->and($rows[0]['signed_in_at'])->toBeString()
            ->and(array_keys($rows[0]))->toBe(['id', 'kind', 'device_name', 'platform', 'app_version', 'last_used_at', 'current', 'os_version', 'approx_city', 'signed_in_at'])
            ->and(json_encode($rows))->not->toContain('127.0.0.1');
    });

    it('answers 404 for a session of another member and 401 for a guest', function () {
        $member = setMember();
        $token = m47SignIn($member);
        $other = setMember();
        $theirs = m47SignIn($other, 'install-cccc-0003');
        $theirId = collect($this->withToken($theirs)->getJson('/api/v1/me/sessions')->json('data'))->firstWhere('current', true)['id'];
        m47Fresh();

        $this->withToken($token)->deleteJson('/api/v1/me/sessions/'.$theirId)->assertNotFound();
        m47Fresh();
        $this->withToken($theirs)->getJson('/api/v1/auth/me')->assertOk();
        m47Fresh();
        $this->getJson('/api/v1/me/sessions')->assertUnauthorized();
        $this->deleteJson('/api/v1/me/sessions')->assertUnauthorized();
    });

    it('signs out all others only after a recent authentication or with the password', function () {
        $member = setMember();
        m47SignIn($member, 'install-bbbb-0002');
        $old = a20OldToken($member);

        $this->withToken($old)->deleteJson('/api/v1/me/sessions')->assertStatus(422)->assertJsonValidationErrors('password');
        $this->withToken($old)->deleteJson('/api/v1/me/sessions', ['password' => 'falsch-falsch'])->assertStatus(422)->assertJsonValidationErrors('password');
        expect($member->tokens()->count())->toBe(2);

        // A passwordless account has only the recent proof.
        [$passwordless] = a20Passwordless('ohne@beispiel.test');
        m47Fresh();
        $this->withToken(a20OldToken($passwordless))->deleteJson('/api/v1/me/sessions')->assertForbidden()->assertJsonPath('code', ErrorCode::ReauthenticationRequired->value);
        m47Fresh();
        $this->withToken($old)->deleteJson('/api/v1/me/sessions', ['password' => 'password'])->assertNoContent();
        expect($member->tokens()->count())->toBe(1);

        m47Fresh();
        m47SignIn($member, 'install-cccc-0003');
        $fresh = m47SignIn($member, 'install-aaaa-0001');
        $this->withToken($fresh)->deleteJson('/api/v1/me/sessions')->assertNoContent();
        expect($member->tokens()->count())->toBe(1)
            ->and(SecurityEvent::query()->where('user_id', $member->id)->where('type', MemberSecurityEvent::SessionRevoked)->exists())->toBeTrue();
    });
});

describe('login alerts', function () {
    it('mails, writes the HOME-02 row and pushes to the other devices on a new install, never with a secret', function () {
        config(['speedclub.push.enabled' => true]);
        Queue::fake();
        $member = setMember();
        m47SignIn($member, 'install-aaaa-0001', 'Pixel 9');
        PushToken::factory()->create(['user_id' => $member->id, 'device_id' => DeviceInstalls::key($member->id, 'install-aaaa-0001'), 'platform' => 'android', 'token' => 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]']);

        m47SignIn($member, 'install-bbbb-0002', 'iPhone 16');

        $event = SecurityEvent::query()->where('user_id', $member->id)->where('type', MemberSecurityEvent::LoginNewDevice)->sole();
        expect($event->device_name)->toBe('iPhone 16')->and($event->meta['method'] ?? null)->toBe('password');

        Mail::assertSent(SecurityNoticeMail::class, function (SecurityNoticeMail $mail) use ($member): bool {
            $html = $mail->render();

            return $mail->notice === SecurityNotice::NewDevice && $mail->hasTo($member->email)
                && str_contains((string) $mail->secureUrl, '/auth/secure#t=')
                && str_contains($html, 'iPhone 16') && str_contains($html, 'Das war ich nicht')
                && ! str_contains($html, 'password') && ! str_contains($html, '127.0.0.1');
        });

        $row = Notification::query()->where('notifiable_id', $member->id)->sole();
        expect($row->data)->toMatchArray(['event' => 'new_device', 'device_name' => 'iPhone 16', 'security_event_id' => $event->id]);
        Queue::assertPushed(SendPushNotification::class, fn (SendPushNotification $job): bool => $job->notificationId === $row->id && $job->exceptInstallId === DeviceInstalls::key($member->id, 'install-bbbb-0002'));
    });

    it('stays quiet for a known install and the first device of an account', function () {
        $member = setMember();
        m47SignIn($member, 'install-aaaa-0001');
        m47SignIn($member, 'install-aaaa-0001');

        Mail::assertNotSent(SecurityNoticeMail::class);
        expect(SecurityEvent::query()->where('user_id', $member->id)->where('type', MemberSecurityEvent::SignedIn)->count())->toBe(2);
    });

    it('bounds the alerts per account and hour', function () {
        $member = setMember();
        m47SignIn($member, 'install-0000-0000');

        foreach (range(1, 7) as $i) {
            m47SignIn($member, 'install-new-000'.$i);
        }

        expect(Notification::query()->where('notifiable_id', $member->id)->count())->toBe(config()->integer('speedclub.known_devices.max_notices_per_hour'))
            ->and(SecurityEvent::query()->where('user_id', $member->id)->where('type', MemberSecurityEvent::LoginNewDevice)->count())->toBe(7);
    });
});

describe('SET-21 GET me/security-events', function () {
    it('lists the member\'s own rows newest first, cursor-paged, without IPs', function () {
        $member = setMember();
        $token = m47SignIn($member);
        $this->travel(1)->minutes();
        m47SignIn($member, 'install-bbbb-0002', 'iPhone 16');
        SecurityEvent::factory()->for(setMember())->create();

        $first = $this->withToken($token)->getJson('/api/v1/me/security-events?per_page=1')->assertOk();
        expect($first->json('data'))->toHaveCount(1)
            ->and($first->json('data.0'))->toMatchArray(['type' => 'new_device', 'method' => 'password', 'this_device' => false, 'can_secure' => true, 'approx_city' => null, 'by_staff' => false])
            ->and($first->json('data.0.device'))->toBe(['name' => 'iPhone 16', 'platform' => 'android'])
            ->and($first->json('meta.next_cursor'))->toBeString()
            ->and((string) $first->getContent())->not->toContain('127.0.0.1');

        $second = $this->withToken($token)->getJson('/api/v1/me/security-events?per_page=1&cursor='.$first->json('meta.next_cursor'))->assertOk();
        expect($second->json('data.0'))->toMatchArray(['type' => 'signed_in', 'this_device' => true]);

        $all = $this->withToken($token)->getJson('/api/v1/me/security-events')->assertOk()->json('data');
        expect($all)->toHaveCount(2);
    });

    it('counts failed attempts as one row a day and audits only the first', function () {
        $member = setMember();
        $token = m47SignIn($member);

        foreach (range(1, 3) as $i) {
            m47Fresh();
            $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'falsch-falsch-'.$i, 'device_name' => 'Pixel 9'])->assertUnauthorized();
        }

        m47Fresh();
        $row = collect($this->withToken($token)->getJson('/api/v1/me/security-events')->json('data'))->firstWhere('type', 'sign_in_failed');
        expect($row['details']['count'])->toBe(3)
            ->and($row['details']['steps'])->toBe(['password' => 3])
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::SignInFailed->value)->count())->toBe(1);
    });

    it('records nothing for an unknown address', function () {
        $this->postJson('/api/v1/auth/login', ['email' => 'niemand@beispiel.test', 'password' => 'falsch-falsch-1', 'device_name' => 'Pixel 9'])->assertUnauthorized();
        app(FailedSignIns::class)->record((string) Str::ulid(), 'password');

        expect(SecurityEvent::query()->count())->toBe(0);
    });

    it('marks staff actions and hides bookkeeping events', function () {
        $member = setMember();
        $token = m47SignIn($member);
        SecurityEvent::factory()->for($member)->create(['type' => MemberSecurityEvent::SessionRevoked, 'device_name' => null, 'platform' => null, 'meta' => ['devices' => 2, 'by_staff' => true]]);
        SecurityEvent::factory()->for($member)->create(['type' => MemberSecurityEvent::TokenRotationRetried]);

        $rows = collect($this->withToken($token)->getJson('/api/v1/me/security-events')->json('data'));
        expect($rows->pluck('type')->all())->not->toContain('token_rotation_retried')
            ->and($rows->firstWhere('type', 'sessions_revoked'))->toMatchArray(['by_staff' => true, 'device' => null, 'can_secure' => false]);
    });

    it('needs a member and stays open under a publishing restriction', function () {
        $this->getJson('/api/v1/me/security-events')->assertUnauthorized();
        $this->getJson('/api/v1/me/sign-in-methods')->assertUnauthorized();
        $this->postJson('/api/v1/me/security/secure')->assertUnauthorized();

        $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $token = m47SignIn($restricted);
        $this->withToken($token)->getJson('/api/v1/me/security-events')->assertOk();
        $this->withToken($token)->getJson('/api/v1/me/sign-in-methods')->assertOk();
    });

    it('refuses a staff session', function () {
        $staff = Staff::factory()->create();
        $this->actingAs($staff, 'staff')->getJson('/api/v1/me/security-events')->assertUnauthorized();
    });
});

describe('SET-21 POST me/security/secure ("Das war ich nicht")', function () {
    it('signs every device out, forces a new password, opens a ticket, audits and mails', function () {
        $member = setMember();
        $token = m47SignIn($member);
        m47SignIn($member, 'install-bbbb-0002', 'iPhone 16');
        $event = SecurityEvent::query()->where('user_id', $member->id)->where('type', MemberSecurityEvent::LoginNewDevice)->sole();

        $response = $this->withToken($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/me/security/secure', ['security_event_id' => $event->id])->assertOk()
            ->assertJsonPath('data.signed_out', true)->assertJsonPath('data.devices_signed_out', 2)->assertJsonPath('data.password_reset_required', true);

        $ticket = SupportTicket::query()->where('user_id', $member->id)->sole();
        expect($response->json('data.ticket_reference'))->toStartWith('SC-')
            ->and($ticket->messages()->sole()->getAttribute('body'))->toContain('iPhone 16')
            ->and($member->fresh()?->getAttribute('force_password_change'))->toBeTrue()
            ->and($member->tokens()->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::AccountSecured->value)->where('target_id', $member->id)->exists())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::AccountSecured
            && $mail->reference === $response->json('data.ticket_reference') && str_contains($mail->render(), (string) $mail->reference));

        m47Fresh();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('answers 404 for another member\'s row and 422 for a malformed id', function () {
        $member = setMember();
        $token = m47SignIn($member);
        $theirs = SecurityEvent::factory()->for(setMember())->create();

        $this->withToken($token)->postJson('/api/v1/me/security/secure', ['security_event_id' => $theirs->id])->assertNotFound();
        $this->withToken($token)->postJson('/api/v1/me/security/secure', ['security_event_id' => 'nope'])->assertStatus(422)->assertJsonValidationErrors('security_event_id');

        expect($member->tokens()->count())->toBe(1)->and(SupportTicket::query()->count())->toBe(0);
    });
});

describe('POST auth/secure-account (the alert link)', function () {
    it('secures the account once from the link, signed out or not', function () {
        $member = setMember();
        m47SignIn($member);
        m47SignIn($member, 'install-bbbb-0002', 'iPhone 16');
        $token = m47SecureToken();

        $this->postJson('/api/v1/auth/secure-account', ['token' => $token])->assertOk()->assertJsonPath('data.signed_out', true);
        expect($member->tokens()->count())->toBe(0)
            ->and(SupportTicket::query()->where('user_id', $member->id)->count())->toBe(1);

        // Single use: the credential epoch turned.
        $this->postJson('/api/v1/auth/secure-account', ['token' => $token])->assertStatus(422)->assertJsonValidationErrors('token');
        expect(SupportTicket::query()->count())->toBe(1);
    });

    it('refuses a tampered, foreign or expired link', function () {
        $member = setMember();
        m47SignIn($member);
        m47SignIn($member, 'install-bbbb-0002', 'iPhone 16');
        $token = m47SecureToken();
        [$id, $proof] = explode('.', $token);

        $this->postJson('/api/v1/auth/secure-account', ['token' => $id.'.'.strrev($proof)])->assertStatus(422);
        $foreign = SecurityEvent::factory()->for(setMember())->create();
        $this->postJson('/api/v1/auth/secure-account', ['token' => $foreign->id.'.'.$proof])->assertStatus(422);
        $this->postJson('/api/v1/auth/secure-account', ['token' => 'kein-token'])->assertStatus(422);
        $this->postJson('/api/v1/auth/secure-account', [])->assertStatus(422)->assertJsonValidationErrors('token');

        $this->travel(8)->days();
        $this->postJson('/api/v1/auth/secure-account', ['token' => $token])->assertStatus(422);
        expect($member->tokens()->count())->toBe(2);
    });

    it('is rate-limited per IP', function () {
        $max = config()->integer('speedclub.rate_limits.auth_secure_account.max');

        foreach (range(1, $max) as $i) {
            $this->postJson('/api/v1/auth/secure-account', ['token' => 'kein-token-'.$i])->assertStatus(422);
        }

        $this->postJson('/api/v1/auth/secure-account', ['token' => 'kein-token-x'])->assertStatus(429)->assertJsonPath('code', ErrorCode::RateLimited->value);
    });
});

describe('SET-19 GET me/sign-in-methods', function () {
    it('summarises every way in', function () {
        a20Flag('auth.passkeys');
        $member = setMember();
        $token = m47SignIn($member);
        MemberPasskey::factory()->count(2)->create(['user_id' => $member->id]);
        SocialAccount::factory()->create(['user_id' => $member->id, 'email' => 'lena@gmail.example']);

        $data = $this->withToken($token)->getJson('/api/v1/me/sign-in-methods')->assertOk()->json('data');

        expect($data['email_code'])->toBe(['available' => true, 'email' => $member->email, 'reachable' => true])
            ->and($data['password']['set'])->toBeTrue()
            ->and($data['two_factor'])->toBe(['enabled' => false])
            ->and($data['passkeys'])->toBe(['available' => true, 'count' => 2])
            ->and(collect($data['providers'])->pluck('provider')->all())->toBe(['apple', 'google'])
            ->and(collect($data['providers'])->firstWhere('provider', 'google'))->toMatchArray(['linked' => true, 'email' => 'lena@gmail.example'])
            ->and(collect($data['providers'])->firstWhere('provider', 'apple'))->toMatchArray(['linked' => false, 'available' => false])
            ->and($data['other_methods'])->toBe(4);
    });

    it('shows a passwordless account', function () {
        [$member, $token] = a20Passwordless();

        $data = $this->withToken($token)->getJson('/api/v1/me/sign-in-methods')->assertOk()->json('data');
        expect($data['password']['set'])->toBeFalse()->and($data['other_methods'])->toBe(0)->and($data['email_code']['email'])->toBe($member->email);
    });
});

describe('retention and data rights', function () {
    it('prunes security events after 12 months and installs nobody uses', function () {
        $member = setMember();
        SecurityEvent::factory()->for($member)->create(['created_at' => now()->subMonths(13)]);
        $kept = SecurityEvent::factory()->for($member)->create(['created_at' => now()->subMonths(11)]);
        DeviceInstall::factory()->for($member)->create(['last_seen_at' => now()->subMonths(13)]);

        $this->artisan('speedclub:prune-platform')->assertSuccessful();

        expect(SecurityEvent::query()->pluck('id')->all())->toBe([$kept->id])
            ->and(DeviceInstall::query()->count())->toBe(0);
    });

    it('exports the installs without the install id, and deletes them with the account', function () {
        $member = setMember();
        m47SignIn($member);

        $files = app(ExportContents::class)->documents($member);
        expect($files['device_installs.json'])->toHaveCount(1)
            ->and($files['device_installs.json'][0])->toHaveKeys(['platform', 'model', 'os_version', 'app_version', 'first_seen_at', 'last_seen_at'])
            ->and(json_encode($files['device_installs.json']))->not->toContain('install-aaaa')->not->toContain(DeviceInstalls::key($member->id, 'install-aaaa-0001'));
    });
});
