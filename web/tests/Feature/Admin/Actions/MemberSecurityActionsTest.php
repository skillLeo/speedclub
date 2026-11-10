<?php

use App\Actions\Admin\Members\ChangeMemberEmail;
use App\Actions\Admin\Members\EditMemberProfile;
use App\Actions\Admin\Members\ForcePasswordChange;
use App\Actions\Admin\Members\RequestTwoFactorReset;
use App\Actions\Admin\Members\ResetMemberTwoFactor;
use App\Actions\Admin\Members\RevokeMemberSessions;
use App\Actions\Admin\Members\SendMemberResetLink;
use App\Enums\ApprovalStatus;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\User;
use App\Models\VerificationCode;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/Helpers.php';

/**
 * M3.2 §2 (ADM-10): the security actions on a member. Staff never see or set a password; each action refuses a staff member without
 * its atom, writes its own audit event with the staff member as actor, and tells the member where 06_ADMIN_SPEC says so.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->member = User::factory()->create(['username' => 'lena.gti', 'email' => 'lena@example.org', 'locale' => 'de']);
});

function m32TwoFactorOn(User $member): User
{
    $member->forceFill(['two_factor_secret' => str_repeat('A', 32), 'two_factor_confirmed_at' => now(), 'two_factor_recovery_codes' => ['x']])->save();

    return $member->refresh();
}

describe('Reset-Link senden', function () {
    it('sends the member their own reset code mail and audits it, never a password', function () {
        app(SendMemberResetLink::class)->handle(m31Staff('support'), $this->member, m32Reason());

        Mail::assertSent(PasswordResetCodeMail::class, fn (PasswordResetCodeMail $mail): bool => $mail->hasTo('lena@example.org'));
        expect(VerificationCode::query()->where('user_id', $this->member->id)->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'member.reset_link_sent')->sole()->getAttribute('actor_type')->value)->toBe('staff');
    });

    it('refuses without members.reset_password', function (string $role, bool $allowed) {
        $run = fn () => app(SendMemberResetLink::class)->handle(m31Staff($role), $this->member, m32Reason());

        $allowed ? $run() : expect($run)->toThrow(AuthorizationException::class);
        expect(AuditEvent::query()->where('action', 'member.reset_link_sent')->count())->toBe($allowed ? 1 : 0);
    })->with(m32Matrix('members.reset_password'));
});

describe('Passwortänderung erzwingen', function () {
    it('sets force_password_change, so earlier tokens stop with password_change_required', function () {
        $token = $this->member->createToken('phone', ['member'])->plainTextToken;

        app(ForcePasswordChange::class)->handle(m31Staff('admin'), $this->member, m32Reason());

        expect($this->member->refresh()->getAttribute('force_password_change'))->toBeTrue();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden()->assertJsonPath('code', 'password_change_required');
        expect(AuditEvent::query()->where('action', 'member.password_change_forced')->sole()->after)->toBe(['must_reset' => true]);
    });

    it('refuses an analyst', function () {
        expect(fn () => app(ForcePasswordChange::class)->handle(m31Staff('analyst'), $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->getAttribute('force_password_change'))->toBeFalse();
    });
});

describe('Alle Sitzungen beenden', function () {
    it('ends every token and push token and sends the security notice in its staff wording', function () {
        $this->member->createToken('phone', ['member']);
        $this->member->createToken('tablet', ['member']);

        $revoked = app(RevokeMemberSessions::class)->handle(m31Staff('support'), $this->member, m32Reason());

        expect($revoked['devices'])->toBe(2)
            ->and($this->member->tokens()->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'member.sessions_revoked_by_staff')->sole()->after['devices'])->toBe(2);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->variant === 'staff' && str_contains($mail->render(), 'Unser Team hat dein Konto'));
    });

    it('refuses without members.revoke_sessions', function (string $role, bool $allowed) {
        $this->member->createToken('phone', ['member']);
        $run = fn () => app(RevokeMemberSessions::class)->handle(m31Staff($role), $this->member, m32Reason());

        $allowed ? $run() : expect($run)->toThrow(AuthorizationException::class);
        expect($this->member->tokens()->count())->toBe($allowed ? 0 : 1);
    })->with(m32Matrix('members.revoke_sessions'));
});

describe('2FA zurücksetzen (four-eyes)', function () {
    it('only asks at the request; the approval clears the second factor and mails the member', function () {
        m32TwoFactorOn($this->member);
        $request = app(RequestTwoFactorReset::class)->handle(m31Staff('admin'), $this->member, m32Reason());

        expect($request->status)->toBe(ApprovalStatus::Pending)
            ->and($this->member->refresh()->hasTwoFactor())->toBeTrue();

        $approver = m31Staff('owner');
        expect(m32Approve($request, $approver)->status)->toBe(ApprovalStatus::Executed)
            ->and($this->member->refresh()->hasTwoFactor())->toBeFalse()
            ->and($this->member->getAttribute('two_factor_recovery_codes'))->toBeNull();

        $event = AuditEvent::query()->where('action', 'member.two_factor_reset')->sole();
        expect($event->after['approved_by'])->toBe($approver->id)
            ->and($event->after['totp_on'])->toBeFalse()
            ->and($event->getAttribute('actor_id'))->toBe((string) $approver->id);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->variant === 'reset_by_staff');
    });

    it('cannot run as one person: the executor refuses requester = approver and a staff member without the atom', function () {
        m32TwoFactorOn($this->member);
        $admin = m31Staff('admin');

        expect(fn () => app(ResetMemberTwoFactor::class)->handle($admin, $admin, $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and(fn () => app(ResetMemberTwoFactor::class)->handle($admin, m31Staff('support'), $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and(fn () => app(RequestTwoFactorReset::class)->handle(m31Staff('support'), $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->hasTwoFactor())->toBeTrue();
    });

    it('refuses to ask when two-factor is off', function () {
        expect(fn () => app(RequestTwoFactorReset::class)->handle(m31Staff('admin'), $this->member, m32Reason()))->toThrow(DomainException::class);
    });
});

describe('E-Mail ändern', function () {
    it('needs the identity check, normalises the address, keeps it verified and mails both addresses', function () {
        $admin = m31Staff('admin');

        expect(fn () => app(ChangeMemberEmail::class)->handle($admin, $this->member, 'neu@example.org', false, m32Reason()))->toThrow(ValidationException::class);

        app(ChangeMemberEmail::class)->handle($admin, $this->member, '  Lena.Neu@Example.ORG ', true, m32Reason());

        expect($this->member->refresh()->email)->toBe('lena.neu@example.org')
            ->and($this->member->hasVerifiedEmail())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->hasTo('lena@example.org') && $mail->variant === 'staff');
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->hasTo('lena.neu@example.org') && $mail->variant === 'staff');

        $event = AuditEvent::query()->where('action', 'member.email_changed_by_staff')->sole();
        // The log is exported: neither address is in it.
        expect(json_encode([$event->before, $event->after]))->not->toContain('lena');
    });

    it('refuses a taken address and a staff member without members.edit', function () {
        User::factory()->create(['email' => 'taken@example.org']);

        expect(fn () => app(ChangeMemberEmail::class)->handle(m31Staff('admin'), $this->member, 'taken@example.org', true, m32Reason()))->toThrow(ValidationException::class)
            ->and(fn () => app(ChangeMemberEmail::class)->handle(m31Staff('support'), $this->member, 'frei@example.org', true, m32Reason()))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->email)->toBe('lena@example.org');
    });
});

describe('Bearbeiten', function () {
    it('changes name, bio, city and username with before and after in the audit log', function () {
        app(EditMemberProfile::class)->handle(m31Staff('admin'), $this->member, ['display_name' => 'Lena', 'bio' => '', 'username' => 'Lena.Golf'], m32Reason());

        expect($this->member->refresh()->username)->toBe('lena.golf')
            ->and($this->member->getAttribute('previous_username'))->toBe('lena.gti')
            ->and($this->member->getAttribute('display_name'))->toBe('Lena')
            ->and($this->member->getAttribute('username_changed_at'))->toBeNull();

        $event = AuditEvent::query()->where('action', 'member.profile_edited')->sole();
        expect($event->after['username'])->toBe('lena.golf')
            ->and($event->before['username'])->toBe('lena.gti')
            ->and($event->getAttribute('reason'))->toBe(m32Reason());
    });

    it('refuses a taken username and a staff member without members.edit', function (string $role, bool $allowed) {
        User::factory()->create(['username' => 'paul.e30']);
        $staff = m31Staff($role);

        if (! $allowed) {
            expect(fn () => app(EditMemberProfile::class)->handle($staff, $this->member, ['display_name' => 'X'], m32Reason()))->toThrow(AuthorizationException::class);

            return;
        }

        expect(fn () => app(EditMemberProfile::class)->handle($staff, $this->member, ['username' => 'paul.e30'], m32Reason()))->toThrow(ValidationException::class)
            ->and($this->member->refresh()->username)->toBe('lena.gti');
    })->with(m32Matrix('members.edit'));
});

it('audits a staff e-mail change with both addresses masked and their domains, never in full (review N-4)', function () {
    app(ChangeMemberEmail::class)->handle(m31Staff('admin'), $this->member, 'lena.neu@gmx.de', true, m32Reason());

    $event = AuditEvent::query()->where('action', 'member.email_changed_by_staff')->sole();

    expect($event->before)->toEqual(['email_masked' => 'l***@e***.org', 'email_domain' => 'example.org'])
        ->and($event->after['email_masked'])->toBe('l***@g***.de')
        ->and($event->after['email_domain'])->toBe('gmx.de')
        ->and(json_encode([$event->before, $event->after]))->not->toContain('lena@example.org')->not->toContain('lena.neu@gmx.de');
});
