<?php

use App\Actions\Admin\Team\AcceptStaffInvite;
use App\Actions\Admin\Team\InviteStaff;
use App\Actions\Admin\Team\ResendStaffInvite;
use App\Enums\ApprovalStatus;
use App\Enums\TeamEvent;
use App\Mail\StaffInviteMail;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\StaffInvitation;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/TeamHelpers.php';

beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
});

/** The token of the last invite mail, read from its link fragment. */
function m36InviteToken(): string
{
    $mail = Mail::sent(StaffInviteMail::class)->last();
    parse_str((string) parse_url($mail->link, PHP_URL_FRAGMENT), $fragment);

    return (string) $fragment['token'];
}

function m36Invite(Staff $by, array $roles = ['support'], ?string $reason = null, string $email = 'neu@speedclub.test')
{
    return app(InviteStaff::class)->handle($by, 'Neue Kollegin', $email, $roles, $reason);
}

it('lets only holders of staff.invite invite', function (string $role, bool $allowed) {
    $run = fn () => m36Invite(m31Staff($role), ['analyst']);

    $allowed ? expect($run()->applied)->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('staff.invite'));

it('creates an account that cannot sign in yet and mails a 72-hour link in the fragment', function () {
    $outcome = m36Invite(m31Staff('admin'));
    $staff = Staff::query()->where('email', 'neu@speedclub.test')->sole();

    expect($outcome->applied)->toBeTrue()->and($outcome->approval)->toBeNull()
        ->and($staff->password_proof_required)->toBeTrue()
        ->and($staff->isInvited())->toBeTrue()
        ->and(m36Roles($staff))->toBe(['support']);

    $mail = Mail::sent(StaffInviteMail::class)->sole();
    expect($mail->link)->toContain('/admin/invite#token=')
        ->and(parse_url($mail->link, PHP_URL_QUERY))->toBeNull()
        ->and($mail->expiresAt->diffInHours(now(), true))->toBeGreaterThan(71.9);

    $invitation = StaffInvitation::query()->sole();
    expect($invitation->token_hash)->toBe(hash('sha256', m36InviteToken()))
        ->and(AuditEvent::query()->where('action', TeamEvent::Invited->value)->sole()->after)->not->toHaveKey('email');
});

it('validates name, address and roles', function (array $input) {
    m31Staff('owner', attributes: ['email' => 'da@speedclub.test']);

    expect(fn () => app(InviteStaff::class)->handle(m31Staff('admin'), $input['name'] ?? 'Name', $input['email'] ?? 'x@speedclub.test', $input['roles'] ?? ['support']))
        ->toThrow(ValidationException::class);
})->with([
    'short name' => [['name' => 'A']],
    'bad address' => [['email' => 'kein-mail']],
    'taken address' => [['email' => 'DA@speedclub.test']],
    'no role' => [['roles' => []]],
    'unknown role' => [['roles' => ['wizard']]],
]);

it('sets the password once through the link, and enrolment comes next', function () {
    m36Invite(m31Staff('admin'));
    $token = m36InviteToken();

    $staff = app(AcceptStaffInvite::class)->handle($token, ['password' => 'Lange-Passphrase-42', 'password_confirmation' => 'Lange-Passphrase-42']);

    expect($staff->password_proof_required)->toBeFalse()
        ->and(Hash::check('Lange-Passphrase-42', $staff->password))->toBeTrue()
        ->and($staff->hasEnabledTwoFactorAuthentication())->toBeFalse()
        ->and($staff->credentials_epoch)->not->toBeNull()
        ->and(StaffInvitation::query()->sole()->used_at)->not->toBeNull()
        ->and(AuditEvent::query()->where('action', TeamEvent::InviteAccepted->value)->exists())->toBeTrue();

    // Single use.
    expect(fn () => app(AcceptStaffInvite::class)->handle($token, ['password' => 'Andere-Passphrase-43', 'password_confirmation' => 'Andere-Passphrase-43']))
        ->toThrow(TeamRefused::class);

    // Then the sign-in works and lands in the TOTP enrolment.
    $this->post('/admin/login', ['email' => 'neu@speedclub.test', 'password' => 'Lange-Passphrase-42'])->assertRedirect('/admin');
    $this->get('/admin')->assertRedirect('/admin/two-factor/setup');
});

it('refuses the sign-in before the link was used', function () {
    m36Invite(m31Staff('admin'));

    $this->post('/admin/login', ['email' => 'neu@speedclub.test', 'password' => 'irgendwas-123'])->assertSessionHasErrors('email');
    expect(auth('staff')->check())->toBeFalse();
});

it('refuses an expired link, a replaced link and a weak password', function () {
    $admin = m31Staff('admin');
    m36Invite($admin);
    $first = m36InviteToken();

    app(ResendStaffInvite::class)->handle($admin, Staff::query()->where('email', 'neu@speedclub.test')->sole());
    $second = m36InviteToken();

    expect($second)->not->toBe($first)
        ->and(fn () => app(AcceptStaffInvite::class)->handle($first, ['password' => 'Lange-Passphrase-42', 'password_confirmation' => 'Lange-Passphrase-42']))
        ->toThrow(TeamRefused::class)
        ->and(fn () => app(AcceptStaffInvite::class)->handle($second, ['password' => 'kurz', 'password_confirmation' => 'kurz']))
        ->toThrow(ValidationException::class);

    $this->travel(73)->hours();

    expect(fn () => app(AcceptStaffInvite::class)->handle($second, ['password' => 'Lange-Passphrase-42', 'password_confirmation' => 'Lange-Passphrase-42']))
        ->toThrow(TeamRefused::class);
});

it('refuses a resend once the password is set', function () {
    $admin = m31Staff('admin');

    expect(fn () => app(ResendStaffInvite::class)->handle($admin, m31Staff('support')))->toThrow(TeamRefused::class);
});

it('keeps elevating roles of an invite for the four-eyes role elevation', function () {
    $admin = m31Staff('admin');
    $outcome = m36Invite($admin, ['admin', 'support'], m36Reason());
    $staff = Staff::query()->where('email', 'neu@speedclub.test')->sole();

    expect($outcome->applied)->toBeTrue()
        ->and($outcome->approval?->action)->toBe('staff.role_elevation')
        ->and(m36Roles($staff))->toBe(['support']);

    expect(m36Approve($outcome->approval, m31Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
        ->and(m36Roles($staff))->toBe(['admin', 'support']);
});

it('lets only an Owner invite an Owner, within the maximum of three', function () {
    expect(fn () => m36Invite(m31Staff('admin'), ['owner'], m36Reason()))->toThrow(TeamRefused::class);

    $owner = m31Staff('owner');
    m31Staff('owner');
    m31Staff('owner');

    expect(fn () => m36Invite($owner, ['owner'], m36Reason()))->toThrow(TeamRefused::class, __('team.refused.max_owners', ['max' => 3]));
});
