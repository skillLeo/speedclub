<?php

use App\Actions\Admin\Account\CancelTotpRotation;
use App\Actions\Admin\Account\ConfirmTotpRotation;
use App\Actions\Admin\Account\RegenerateRecoveryCodes;
use App\Actions\Admin\Account\RevokeOwnSession;
use App\Actions\Admin\Account\ShowRecoveryCodes;
use App\Actions\Admin\Account\StartTotpRotation;
use App\Enums\StaffSecurityEvent;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamRefused;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;

require_once __DIR__.'/../Team/TeamHelpers.php';

/** A session store with a valid (40 alphanumeric characters) id, or the Store makes up another. */
function m36Session(string $id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'): Store
{
    $session = new Store('test', new ArraySessionHandler(30), $id);
    $session->start();

    return $session;
}

function m36Code(string $secret): string
{
    return app(Google2FA::class)->getCurrentOtp($secret);
}

function m36Secret(Staff $staff): string
{
    return (string) Fortify::currentEncrypter()->decrypt((string) $staff->fresh()->two_factor_secret);
}

it('rotates TOTP: the old key works until a code of the new key confirms it, then the epoch moves', function () {
    $staff = m31Staff('support');
    $old = m36Secret($staff);
    $session = m36Session();
    $epoch = $staff->fresh()->credentials_epoch;

    $started = app(StartTotpRotation::class)->handle($staff, m36Code($old), $session);

    expect($started['secret'])->toHaveLength(32)
        ->and($started['qr_svg'])->toStartWith('<svg')
        ->and(m36Secret($staff))->toBe($old)
        ->and($staff->fresh()->two_factor_pending_secret)->toBe($started['secret'])
        // Encrypted at rest.
        ->and(DB::table('staff')->where('id', $staff->id)->value('two_factor_pending_secret'))->not->toContain($started['secret'])
        ->and($staff->fresh()->toArray())->not->toHaveKey('two_factor_pending_secret');

    // A code of the old key does not confirm the new one.
    $this->travel(31)->seconds();
    expect(fn () => app(ConfirmTotpRotation::class)->handle($staff->fresh(), m36Code($old), $session))->toThrow(TeamRefused::class, __('team.refused.code_invalid'));

    app(ConfirmTotpRotation::class)->handle($staff->fresh(), m36Code($started['secret']), $session);
    $after = $staff->fresh();

    expect(m36Secret($after))->toBe($started['secret'])
        ->and($after->two_factor_pending_secret)->toBeNull()
        ->and($after->credentials_epoch)->not->toBe($epoch)
        ->and($session->get('staff.credentials_epoch'))->toBe($after->credentials_epoch)
        ->and(AuditEvent::query()->pluck('action')->all())->toContain(StaffSecurityEvent::TwoFactorRotationStarted->value, StaffSecurityEvent::TwoFactorRotated->value);
});

it('refuses to start a rotation without a current code', function (string $code) {
    $staff = m31Staff('support');

    expect(fn () => app(StartTotpRotation::class)->handle($staff, $code, m36Session()))->toThrow(TeamRefused::class)
        ->and($staff->fresh()->two_factor_pending_secret)->toBeNull()
        ->and(AuditEvent::query()->where('action', StaffSecurityEvent::CodeCheckFailed->value)->count())->toBe(1);
})->with(['wrong' => '000000', 'not six digits' => 'abc', 'empty' => '']);

it('keeps the pending key to the session that started it and to its time', function () {
    $staff = m31Staff('support');
    $started = app(StartTotpRotation::class)->handle($staff, m36Code(m36Secret($staff)), m36Session(str_repeat('a', 40)));

    expect(fn () => app(ConfirmTotpRotation::class)->handle($staff->fresh(), m36Code($started['secret']), m36Session(str_repeat('b', 40))))
        ->toThrow(TeamRefused::class, __('team.refused.rotation_elsewhere'));

    $this->travel(16)->minutes();
    expect(fn () => app(ConfirmTotpRotation::class)->handle($staff->fresh(), m36Code($started['secret']), m36Session(str_repeat('a', 40))))
        ->toThrow(TeamRefused::class, __('team.refused.rotation_expired'));
});

it('cancels a pending rotation and keeps the old key', function () {
    $staff = m31Staff('support');
    $old = m36Secret($staff);
    app(StartTotpRotation::class)->handle($staff, m36Code($old), m36Session());

    app(CancelTotpRotation::class)->handle($staff->fresh());

    expect($staff->fresh()->two_factor_pending_at)->toBeNull()->and(m36Secret($staff))->toBe($old);
});

it('limits wrong codes per account', function () {
    // The refusal names the seconds left: on a loaded machine a second can pass before the check, so the clock stands still here.
    $this->freezeTime();
    $staff = m31Staff('support');

    foreach (range(1, 5) as $ignored) {
        try {
            app(ShowRecoveryCodes::class)->handle($staff, '000000');
        } catch (TeamRefused) {
        }
    }

    expect(fn () => app(ShowRecoveryCodes::class)->handle($staff, m36Code(m36Secret($staff))))->toThrow(TeamRefused::class, __('team.refused.too_many_codes', ['seconds' => 60]));
});

it('shows recovery codes only after a current code, audited without the codes', function () {
    $staff = m31Staff('support');

    expect(fn () => app(ShowRecoveryCodes::class)->handle($staff, '123456'))->toThrow(TeamRefused::class);

    $codes = app(ShowRecoveryCodes::class)->handle($staff, m36Code(m36Secret($staff)));
    $event = AuditEvent::query()->where('action', StaffSecurityEvent::RecoveryCodesViewed->value)->sole();

    expect($codes)->toBe($staff->fresh()->recoveryCodes())
        ->and(json_encode([$event->before, $event->after, $event->reason]))->not->toContain($codes[0]);
});

it('regenerates recovery codes only after a current code, and moves the epoch', function () {
    $staff = m31Staff('support');
    $old = $staff->recoveryCodes();
    $session = m36Session();

    expect(fn () => app(RegenerateRecoveryCodes::class)->handle($staff, '123456', $session))->toThrow(TeamRefused::class)
        ->and($staff->fresh()->recoveryCodes())->toBe($old);

    $new = app(RegenerateRecoveryCodes::class)->handle($staff, m36Code(m36Secret($staff)), $session);

    expect($new)->toHaveCount(8)
        ->and($staff->fresh()->recoveryCodes())->toBe($new)
        ->and(array_intersect($new, $old))->toBe([])
        ->and($session->get('staff.credentials_epoch'))->toBe($staff->fresh()->credentials_epoch)
        ->and(json_encode(AuditEvent::query()->where('action', StaffSecurityEvent::RecoveryCodesRegenerated->value)->sole()->after))->not->toContain($new[0]);
});

it('refuses the code steps for an account without confirmed TOTP', function () {
    $staff = m31Staff('support', confirmed: false);

    expect(fn () => app(ShowRecoveryCodes::class)->handle($staff, '123456'))->toThrow(TeamRefused::class, __('team.refused.no_two_factor'));
});

it('ends one other own session or all others, never this one', function () {
    config(['session.driver' => 'database']);
    $staff = m31Staff('support');
    $current = m36Session(str_repeat('c', 40));

    foreach ([str_repeat('c', 40), 'phone-session', 'laptop-session'] as $id) {
        DB::table('sessions')->insert(['id' => $id, 'user_id' => (string) $staff->id, 'payload' => 'x', 'last_activity' => now()->getTimestamp()]);
    }

    expect(fn () => app(RevokeOwnSession::class)->handle($staff, StaffSessions::handle($current->getId()), $current))->toThrow(TeamRefused::class, __('team.refused.current_session'))
        ->and(fn () => app(RevokeOwnSession::class)->handle($staff, 'unknown-handle', $current))->toThrow(TeamRefused::class);

    app(RevokeOwnSession::class)->handle($staff, StaffSessions::handle('phone-session'), $current);
    expect(DB::table('sessions')->pluck('id')->sort()->values()->all())->toBe([str_repeat('c', 40), 'laptop-session']);

    expect(app(RevokeOwnSession::class)->others($staff, $current))->toBe(1)
        ->and(DB::table('sessions')->pluck('id')->all())->toBe([str_repeat('c', 40)])
        ->and($current->get('staff.credentials_epoch'))->toBe($staff->fresh()->credentials_epoch);
});
