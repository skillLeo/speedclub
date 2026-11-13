<?php

use App\Enums\DataExportStatus;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\UserStatus;
use App\Enums\VerificationPurpose;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Mail\VerificationCodeMail;
use App\Models\AuditEvent;
use App\Models\DataExport;
use App\Models\HelpArticle;
use App\Models\PushSubscription;
use App\Models\PushToken;
use App\Models\SupportTicket;
use App\Models\User;
use App\Services\Account\HardDeleteAccount;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\MemberSessions;
use App\Services\Auth\TwoFactorChallenges;
use App\Services\Auth\VerificationCodes;
use App\Services\DataExport\BuildDataExport;
use App\Services\DataExport\ExportContents;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use App\Support\Auth\DeviceInfo;
use App\Support\Session\NoIpDatabaseSessionHandler;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    Storage::fake('local');
    config(['speedclub.media.private_disk' => 'local']);
});

function setChallenge(User $member): string
{
    return (string) test()->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])
        ->assertOk()->json('data.challenge');
}

describe('must-fix 1: one long budget of wrong second factors per account', function () {
    it('mails the owner at the first wrong code after a correct password, once an hour', function () {
        $member = setMember();
        setEnableTwoFactor($member);
        $challenge = setChallenge($member);

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '000000', 'device_name' => 'Pixel 9'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '000001', 'device_name' => 'Pixel 9'])->assertUnprocessable();

        Mail::assertSent(SecurityNoticeMail::class, 1);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::VerificationFailed && $mail->variant === 'second_factor');
    });

    it('locks after 10 wrong codes in an hour, counted across challenge, re-check and WEB-05, until a reset', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);

        // 4 at sign-in (two challenges), 3 in the app's re-check, 3 on WEB-05: one budget.
        foreach ([setChallenge($member), setChallenge($member)] as $challenge) {
            for ($i = 0; $i < 2; $i++) {
                $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '00000'.$i, 'device_name' => 'Pixel 9'])->assertUnprocessable();
            }
        }

        Sanctum::actingAs($member);
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/me/delete', ['password' => 'password', 'code' => '11111'.$i])->assertUnprocessable()->assertJsonValidationErrors('code');
        }
        app('auth')->forgetGuards();

        for ($i = 0; $i < 3; $i++) {
            $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1', 'code' => '22222'.$i])->assertUnprocessable();
        }

        $fresh = $member->fresh();
        expect($fresh->hasLockedSecondFactor())->toBeTrue()
            ->and($fresh->isPendingDeletion())->toBeFalse()
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::SecondFactorLocked->value)->exists())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->variant === 'locked');

        // No new challenge, even with the right password; the right code no longer helps either.
        $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])
            ->assertForbidden()->assertJsonPath('code', 'second_factor_locked');
        Sanctum::actingAs($member->fresh());
        $this->postJson('/api/v1/me/delete', ['password' => 'password', 'code' => setOtp($secret)])->assertForbidden()->assertJsonPath('code', 'second_factor_locked');
        app('auth')->forgetGuards();

        // A password reset by e-mail code lifts the lock; two-factor stays on.
        $code = app(VerificationCodes::class)->issue($member->fresh(), VerificationPurpose::PasswordReset);
        $this->postJson('/api/v1/auth/password/reset', ['email' => $member->email, 'code' => $code, 'password' => 'Neues-Passwort-2026!'])->assertOk();
        expect($member->fresh()->hasLockedSecondFactor())->toBeFalse()->and($member->fresh()->hasTwoFactor())->toBeTrue();
        $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'Neues-Passwort-2026!', 'device_name' => 'Pixel 9'])
            ->assertOk()->assertJsonPath('data.two_factor_required', true);
    });

    it('locks after 20 wrong codes in a day, even when no hour holds 10', function () {
        $member = setMember();
        setEnableTwoFactor($member);

        for ($round = 0; $round < 3; $round++) {
            $challenge = setChallenge($member);

            for ($i = 0; $i < 5; $i++) {
                if ($round * 5 + $i >= 20) {
                    break;
                }
                $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '00000'.$i, 'device_name' => 'Pixel 9']);
            }

            $this->travel(61)->minutes();
        }

        expect($member->fresh()->hasLockedSecondFactor())->toBeFalse();

        $challenge = setChallenge($member);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '00000'.$i, 'device_name' => 'Pixel 9']);
        }

        expect($member->fresh()->hasLockedSecondFactor())->toBeTrue();
    });
});

describe('must-fix 2: an export survives a pending deletion until it expires', function () {
    it('builds and serves an export asked for before the deletion, and the hard delete removes it', function () {
        $member = setMember();
        Sanctum::actingAs($member);
        $id = $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202)->json('data.id');
        $url = (string) $this->getJson('/api/v1/me/exports')->json('data.0.download_url');

        $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
        app('auth')->forgetGuards();

        $export = DataExport::query()->findOrFail($id);
        expect($export->status)->toBe(DataExportStatus::Ready)
            ->and(Storage::disk('local')->exists(BuildDataExport::zipPath($export)))->toBeTrue();
        $this->get($url)->assertOk();

        $this->travel(30)->days();
        (new HardDeleteAccount($member->id))->handle(app(MediaService::class), app(QrCodes::class), app(MemberSessions::class), app(OgImages::class));

        expect(DataExport::query()->find($id))->toBeNull()
            ->and(Storage::disk('local')->exists(BuildDataExport::zipPath($export)))->toBeFalse();
    });

    it('still builds an export queued before the deletion', function () {
        $member = setMember();
        $export = DataExport::factory()->create(['user_id' => $member->id]);
        $member->forceFill(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()])->save();

        (new BuildDataExport($export->id))->handle(app(ExportContents::class), app(AuthMailer::class));

        expect($export->fresh()->status)->toBe(DataExportStatus::Ready);
    });

    it('builds nothing for a staff deactivation', function () {
        $member = User::factory()->create(['status' => UserStatus::Deactivated]);
        $export = DataExport::factory()->create(['user_id' => $member->id]);

        (new BuildDataExport($export->id))->handle(app(ExportContents::class), app(AuthMailer::class));

        expect(DataExport::query()->find($export->id))->toBeNull();
    });
});

describe('should-fix 3, 4, 10, 11 and nit 26: the export', function () {
    it('stops and leaves no file when the row goes while a step runs, and prune sweeps orphans', function () {
        $member = setMember();
        $export = DataExport::factory()->create(['user_id' => $member->id]);
        $contents = Mockery::mock(ExportContents::class)->makePartial();
        $contents->shouldReceive('documents')->andReturnUsing(function () use ($export): array {
            DataExport::query()->whereKey($export->id)->delete();

            return ['profile.json' => []];
        });

        (new BuildDataExport($export->id))->handle($contents, app(AuthMailer::class));
        expect(Storage::disk('local')->exists(BuildDataExport::zipPath($export)))->toBeFalse();

        Storage::disk('local')->put('exports/01jzzzzzzzzzzzzzzzzzzzzzzz.zip', 'left behind');
        Storage::disk('local')->put('exports/01jzzzzzzzzzzzzzzzzzzzzzzz.zip.entries.json', '[]');
        $live = DataExport::factory()->ready()->create(['user_id' => $member->id]);
        Storage::disk('local')->put(BuildDataExport::zipPath($live), 'live');

        $this->artisan('exports:prune')->assertSuccessful();

        expect(Storage::disk('local')->files('exports'))->toBe([BuildDataExport::zipPath($live)]);
    });

    it('never caches an answer that carries the signed link', function () {
        Sanctum::actingAs(setMember());

        setAssertNoStore($this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202));
        setAssertNoStore($this->getJson('/api/v1/me/exports')->assertOk());
    });

    it('adds security events without IP, reactions, push installs and browser sessions, and pages conversations by keyset', function () {
        config(['speedclub.data_export.conversations_per_file' => 1, 'session.driver' => 'database']);
        $member = setMember(['username' => 'lukas.sc']);
        $first = msgStart($member, setMember(), 'Eins');
        msgStart($member, setMember(), 'Zwei');
        msgStart($member, setMember(), 'Drei');
        DB::table('message_reactions')->insert(['message_id' => $first->id, 'user_id' => $member->id, 'reaction' => 'fire', 'created_at' => now()]);
        PushToken::factory()->create(['user_id' => $member->id, 'token' => 'ExponentPushToken[ffffffffffffffffffffff]']);
        // M4.15: a browser with Web Push.
        PushSubscription::factory()->create(['user_id' => $member->id]);
        DB::table('sessions')->insert(['id' => 'sess-1', 'user_id' => $member->id, 'ip_address' => null, 'user_agent' => 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0', 'payload' => 'x', 'last_activity' => now()->getTimestamp()]);
        setSignIn($member, 'install-sec-00001');

        Sanctum::actingAs($member);
        $id = $this->postJson('/api/v1/me/export', ['password' => 'password'])->json('data.id');
        $files = setReadZip(DataExport::query()->findOrFail($id));

        expect(array_keys($files))->toContain('conversations/0001.json', 'conversations/0002.json', 'conversations/0003.json')
            ->and(json_decode($files['reactions.json'], true)[0]['reaction'])->toBe('fire')
            ->and(json_decode($files['push_devices.json'], true)[0])->not->toHaveKey('token')
            ->and(json_decode($files['web_push_browsers.json'], true)[0])->toHaveKeys(['browser', 'created_at', 'last_used_at'])
            ->and($files['web_push_browsers.json'])->not->toContain('fcm.googleapis.com')
            ->and(json_decode($files['browser_sessions.json'], true)[0]['browser'])->toBe('Firefox auf Windows')
            ->and(collect(json_decode($files['security_events.json'], true))->pluck('action')->all())->toContain('member.data_export_requested')
            ->and($files['security_events.json'])->not->toContain('ip')
            ->and($files['README.txt'])->toContain('security_events.json')->toContain('conversations/');
    });

    it('waits when all export files together reach the disk cap', function () {
        config(['speedclub.data_export.max_total_mb' => 1]);
        Storage::disk('local')->put('exports/big.bin', str_repeat('x', 1048576));
        Sanctum::actingAs(setMember());

        $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(503)->assertJsonPath('code', 'service_unavailable');
        expect(DataExport::query()->count())->toBe(0);
    });
});

describe('should-fix 5: wrong passwords in re-checks', function () {
    it('allows 5 an hour per account, mails once and audits each', function () {
        $member = setMember();
        Sanctum::actingAs($member);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/me/export', ['password' => 'falsch-falsch'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(429)->assertHeader('Retry-After');
        Mail::assertSent(SecurityNoticeMail::class, 1);
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::PasswordCheckFailed->value)->count())->toBe(5);

        $this->travel(61)->minutes();
        $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
    });
});

describe('should-fix 6, 7, 8: the challenge', function () {
    it('belongs to the device that asked', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);
        $challenge = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9', 'device_id' => 'install-aaaa-1111'])->json('data.challenge');

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret), 'device_name' => 'Pixel 9', 'device_id' => 'install-bbbb-2222'])
            ->assertUnprocessable()->assertJsonPath('code', 'challenge_expired');

        // Untouched for the device that asked.
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret), 'device_name' => 'Pixel 9', 'device_id' => 'install-aaaa-1111'])->assertOk();
    });

    it('is taken once, atomically, and a wrong code puts it back', function () {
        $member = setMember();
        $challenges = app(TwoFactorChallenges::class);
        $request = Request::create('/');
        $device = new DeviceInfo('Pixel 9');
        $token = $challenges->issue($member, $device, $request);

        $taken = $challenges->take($token, $device, $request);
        expect($taken)->not->toBeNull()->and($challenges->take($token, $device, $request))->toBeNull();

        $challenges->putBack($token, $taken['entry']);
        expect($challenges->take($token, $device, $request)['user']->id ?? null)->toBe($member->id);
    });

    it('mails the owner after a sign-in with a recovery code, naming the codes left', function () {
        $member = setMember();
        [, $recovery] = setEnableTwoFactor($member);
        $challenge = setChallenge($member);

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'recovery_code' => $recovery[0], 'device_name' => 'Pixel 9'])->assertOk();

        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::RecoveryCodeUsed && $mail->count === 9);
    });
});

it('should-fix 9: browser sessions keep no IP address, but the user agent', function () {
    config(['session.driver' => 'database']);
    $member = setMember();

    expect(app('session')->driver('database')->getHandler())->toBeInstanceOf(NoIpDatabaseSessionHandler::class);

    $id = databaseSessionFor($member, 'web');
    $row = DB::table('sessions')->where('id', $id)->first();

    expect($row)->not->toBeNull()->and($row?->ip_address)->toBeNull()->and($row?->user_agent)->not->toBeNull();
});

describe('nits', function () {
    it('15: any password change ends the other browser sessions', function () {
        config(['session.driver' => 'database']);
        $member = setMember();
        $here = setSignIn($member, 'install-here-0001');
        DB::table('sessions')->insert(['id' => 'other-browser', 'user_id' => $member->id, 'ip_address' => null, 'user_agent' => 'Safari', 'payload' => 'x', 'last_activity' => now()->getTimestamp()]);

        $this->withToken($here)->postJson('/api/v1/me/password', ['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26'])->assertNoContent();

        expect(DB::table('sessions')->where('id', 'other-browser')->exists())->toBeFalse();
    });

    it('16: the replaced token of this install counts as this device', function () {
        $member = setMember();
        $old = setSignIn($member, 'install-here-0001');
        $oldId = $member->tokens()->value('id');
        $member->tokens()->update(['created_at' => now()->subDays(8)]);
        $new = (string) $this->withToken($old)->postJson('/api/v1/auth/token/rotate', ['device_id' => 'install-here-0001'])->json('data.token');
        app('auth')->forgetGuards();

        $this->withToken($new)->deleteJson('/api/v1/me/sessions/t'.$oldId)->assertUnprocessable()->assertJsonValidationErrors('id');
    });

    it('20: a same-host Origin passes on the host the request reached', function () {
        $this->withHeaders(['Origin' => 'http://localhost'])->post('http://localhost/kontakt', ['name' => 'Jana', 'email' => 'jana@example.de', 'category' => 'other', 'message' => 'Eine Frage an das Team, bitte.'])->assertOk();
    });

    it('21: the help list is bounded by articles, not rows', function () {
        config(['speedclub.help.max_articles' => 2]);
        foreach (['a-1', 'a-2', 'a-3'] as $sort => $key) {
            HelpArticle::factory()->create(['key' => $key, 'locale' => 'de', 'sort' => $sort]);
            HelpArticle::factory()->create(['key' => $key, 'locale' => 'en', 'sort' => $sort]);
        }

        $this->getJson('/api/v1/help', ['Accept-Language' => 'en'])->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.locale', 'en');
    });

    it('22: the hard delete needs the closed status, and an overdue account is reported', function () {
        $member = setMember();
        $member->forceFill(['deletion_requested_at' => now()->subDays(40)])->save();

        expect(HardDeleteAccount::isDue($member->fresh()))->toBeFalse();

        $member->forceFill(['status' => UserStatus::Deactivated])->save();
        Bus::fake([HardDeleteAccount::class]);
        $this->artisan('accounts:prune')->expectsOutputToContain('past their 30 days')->assertSuccessful();
    });

    it('23: e-mail verification of a closed account answers invalid_code', function () {
        $member = User::factory()->unverified()->create(['email' => 'zu@example.de']);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        $member->forceFill(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()])->save();

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'zu@example.de', 'code' => $code, 'password' => 'password', 'device_name' => 'Pixel 9'])
            ->assertUnprocessable()->assertJsonPath('code', 'invalid_code');
        expect($member->fresh()->hasVerifiedEmail())->toBeFalse();
    });

    it('24: support tickets go 24 months after their last change', function () {
        $old = SupportTicket::factory()->create();
        $recent = SupportTicket::factory()->create();
        SupportTicket::query()->whereKey($old->id)->update(['updated_at' => now()->subMonths(25)]);

        $this->artisan('support:prune')->assertSuccessful();

        expect(SupportTicket::query()->find($old->id))->toBeNull()->and(SupportTicket::query()->find($recent->id))->not->toBeNull();
    });

    it('14: re-check audits name the factor', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);
        Sanctum::actingAs($member);

        $this->deleteJson('/api/v1/me/two-factor', ['password' => 'password', 'code' => setOtp($secret)])->assertNoContent();

        $after = AuditEvent::query()->where('action', MemberSecurityEvent::TwoFactorDisabled->value)->value('after');
        expect(is_string($after) ? json_decode($after, true) : $after)->toBe(['factor' => 'totp']);
    });
});

describe('WEB-07: verify and reset mails land on /email/{action} with the fragment', function () {
    it('links the verify mail to /email/verify#code=…&email=…, never a query', function () {
        $html = (new VerificationCodeMail('123456', 'lena@example.de'))->render();

        expect($html)->toContain(url('/email/verify').'#code=123456&amp;email=lena%40example.de')->not->toContain('?code=');
    });

    it('links the reset mail to /email/reset#code=…&email=…', function () {
        $html = (new PasswordResetCodeMail('654321', 'lena@example.de'))->render();

        expect($html)->toContain(url('/email/reset').'#code=654321&amp;email=lena%40example.de')->not->toContain('/app/reset-password');
    });
});
