<?php

namespace App\Models;

use App\Enums\StaffStatus;
use App\Services\Auth\AuthMailer;
use BaconQrCode\Renderer\Color\Rgb;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\Fill;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Database\Factories\StaffFactory;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Laravel\Fortify\TwoFactorAuthenticatable;
use Spatie\Permission\Traits\HasRoles;

/**
 * Admin portal account. Completely separate from members (table, guard, cookie, password broker).
 *
 * @property int $id
 * @property string $name
 * @property string $email
 * @property string $password
 * @property StaffStatus $status
 * @property string|null $credentials_epoch
 * @property bool $password_proof_required
 * @property Carbon|null $deactivated_at
 * @property Carbon|null $anonymised_at
 * @property Carbon|null $two_factor_confirmed_at
 * @property string|null $two_factor_pending_secret the key of an unconfirmed rotation (ADM-51), decrypted by the cast
 * @property string|null $two_factor_pending_session
 * @property Carbon|null $two_factor_pending_at
 */
#[Table('staff')]
#[Fillable(['name', 'email', 'password', 'status'])]
#[Hidden(['password', 'remember_token', 'credentials_epoch', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_pending_secret', 'two_factor_pending_session'])]
class Staff extends Authenticatable
{
    /** @use HasFactory<StaffFactory> */
    use HasFactory, HasRoles, Notifiable, TwoFactorAuthenticatable;

    protected string $guard_name = 'staff';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'status' => StaffStatus::class,
            'two_factor_confirmed_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password_proof_required' => 'boolean',
            'is_sample' => 'boolean',
            'deactivated_at' => 'datetime',
            'anonymised_at' => 'datetime',
            'two_factor_pending_secret' => 'encrypted',
            'two_factor_pending_at' => 'datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === StaffStatus::Active;
    }

    public function isOwner(): bool
    {
        return $this->hasRole('owner');
    }

    /** Owner or Admin: deactivating such an account is four-eyes (06 §2). */
    public function isPrivileged(): bool
    {
        return $this->hasRole(['owner', 'admin']);
    }

    /** Invited and not yet through the mailed link (SEC-P1-20, ADR-218). */
    public function isInvited(): bool
    {
        return $this->password_proof_required && $this->anonymised_at === null;
    }

    /**
     * After the response, like every auth mail (AuthMailer): the time of a reset request must not tell whether the address
     * belongs to staff (SEC-P1-02). Not in production with the log mailer, which would write the link to the log (SEC-P1-27).
     *
     * At most speedclub.rate_limits.staff_password_reset links per address in its window, counted here, when a link is really sent:
     * requests that send nothing (an unknown address, the broker's 60 seconds) no longer hold back the owner's own link (SEC-P1-21).
     * Keyed on the account's own address, so accent variants that reach the same row share it (SEC-P1-29).
     *
     * @param  string  $token
     */
    public function sendPasswordResetNotification($token): void
    {
        $mailer = app(AuthMailer::class);

        $mailer->afterResponse(function () use ($mailer, $token): void {
            $key = 'staff-reset-link-sent:'.hash('sha256', Str::transliterate(Str::lower($this->email)));
            $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');

            if (RateLimiter::tooManyAttempts($key, $max) || ! $mailer->mayDeliver()) {
                return;
            }

            RateLimiter::hit($key, config()->integer('speedclub.rate_limits.staff_password_reset.minutes') * 60);
            $this->notify(new ResetPassword($token));
        });
    }

    /**
     * The enrolment QR of ADM-03 (Fortify's `two-factor.qr-code`): pure black modules on white, the highest contrast for every
     * authenticator camera, instead of Fortify's slate on white. Same size and data as Fortify's own.
     */
    public function twoFactorQrCodeSvg(): string
    {
        $svg = (new Writer(new ImageRenderer(
            new RendererStyle(192, 0, null, null, Fill::uniformColor(new Rgb(255, 255, 255), new Rgb(0, 0, 0))),
            new SvgImageBackEnd,
        )))->writeString($this->twoFactorQrCodeUrl());

        return trim(substr($svg, (int) strpos($svg, "\n") + 1));
    }
}
