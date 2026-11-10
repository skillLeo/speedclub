<?php

namespace App\Models;

use App\Enums\OnboardingStep;
use App\Enums\PowerDisplay;
use App\Enums\RestrictionType;
use App\Enums\ThemePreference;
use App\Enums\UserStatus;
use App\Enums\WhoCanMessage;
use App\Support\EmailAddress;
use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;
use Database\Factories\UserFactory;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Member account. status, restrictions, email_verified_at and the two-factor columns are not fillable:
 * only Actions change them, through forceFill.
 *
 * restrictions: {"messaging": {"until": "<ISO 8601>"|null, "decision_id"?: …}, "publishing": {…}, "suspension": {"until": …}}. decision_id
 * names the moderation decision that set it (M2.6, App\Actions\Moderation\DecideCase).
 * A key that is present applies until "until" has passed; null or an unreadable date means no end date.
 * Status suspended without a suspension key counts as suspended without an end date: fail closed.
 *
 * @property string $id
 * @property string $email
 * @property string|null $username null until the member chose one (AUTH-08)
 * @property UserStatus $status
 * @property array<string, array{until?: string|null, decision_id?: string|null}>|null $restrictions
 */
#[Fillable([
    'email', 'password', 'username', 'display_name', 'city', 'bio', 'locale', 'theme', 'power_display',
    'who_can_message', 'discoverable', 'indexable', 'show_owner_on_qr', 'read_receipts', 'ai_suggestions', 'notification_prefs',
    'terms_version', 'privacy_version', 'consented_at', 'marketing_consent_at',
])]
#[Hidden(['password', 'remember_token', 'credentials_epoch', 'two_factor_secret', 'two_factor_recovery_codes'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUlids, Notifiable, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'username_changed_at' => 'datetime',
            'profile_setup_at' => 'datetime',
            'theme' => ThemePreference::class,
            'power_display' => PowerDisplay::class,
            'who_can_message' => WhoCanMessage::class,
            'discoverable' => 'boolean',
            'indexable' => 'boolean',
            'show_owner_on_qr' => 'boolean',
            'read_receipts' => 'boolean',
            'ai_suggestions' => 'boolean',
            'notification_prefs' => 'array',
            'two_factor_secret' => 'encrypted',
            'two_factor_recovery_codes' => 'encrypted:array',
            'two_factor_confirmed_at' => 'datetime',
            'two_factor_last_step' => 'integer',
            'two_factor_locked_at' => 'datetime',
            'status' => UserStatus::class,
            'restrictions' => 'array',
            'force_password_change' => 'boolean',
            'last_seen_at' => 'datetime',
            'consented_at' => 'datetime',
            'marketing_consent_at' => 'datetime',
            'deletion_requested_at' => 'datetime',
        ];
    }

    /**
     * @return Attribute<string, string>
     */
    protected function email(): Attribute
    {
        return Attribute::make(set: fn (string $value): string => EmailAddress::normalize($value));
    }

    /**
     * @return Attribute<string|null, string|null>
     */
    protected function username(): Attribute
    {
        return Attribute::make(set: fn (?string $value): ?string => $value === null ? null : mb_strtolower(trim($value)));
    }

    public function isDeactivated(): bool
    {
        return $this->status === UserStatus::Deactivated || $this->trashed();
    }

    /**
     * The member asked for deletion (SET-13, WEB-05): closed at once, hard-deleted after 30 days. Sign-in answers as for an unknown
     * account; V1 has no way back.
     */
    public function isPendingDeletion(): bool
    {
        return $this->getAttribute('deletion_requested_at') !== null;
    }

    /**
     * TOTP confirmed (SET-05). A secret that was never confirmed is only a pending setup.
     */
    public function hasTwoFactor(): bool
    {
        return $this->getAttribute('two_factor_confirmed_at') !== null && $this->getAttribute('two_factor_secret') !== null;
    }

    /**
     * Too many wrong second factors (SecondFactorGuard): no new challenge and no re-check until a password reset by e-mail code.
     */
    public function hasLockedSecondFactor(): bool
    {
        return $this->getAttribute('two_factor_locked_at') !== null;
    }

    public function isSuspended(): bool
    {
        return $this->status === UserStatus::Suspended
            && (! isset($this->restrictions['suspension']) || $this->isInForce('suspension'));
    }

    public function isRestrictedFrom(RestrictionType $type): bool
    {
        return $this->isSuspended() || $this->isInForce($type->value);
    }

    /**
     * End of a restriction for the 403 account_restricted response; null means no end date or none in force.
     */
    public function restrictedUntil(RestrictionType $type): ?CarbonImmutable
    {
        $key = $this->isSuspended() ? 'suspension' : $type->value;

        return $this->isInForce($key) ? $this->endOf($key) : null;
    }

    /**
     * Not deactivated and not suspended. A lapsed suspension no longer counts.
     */
    public function isActive(): bool
    {
        return ! $this->isDeactivated() && ! $this->isSuspended();
    }

    /**
     * Others can see the profile and vehicles. Nobody has a public page before proving the address: until then the name
     * and pictures may be a stranger's, under somebody else's address (ADR-135).
     */
    public function isPubliclyVisible(): bool
    {
        return $this->isActive() && $this->hasVerifiedEmail();
    }

    /**
     * Blocks are bidirectional and override everything else (02_PRODUCT_SPEC §3.5).
     */
    public function hasBlockWith(self $other): bool
    {
        return Block::query()
            ->where(fn ($query) => $query->where('blocker_id', $this->id)->where('blocked_id', $other->id))
            ->orWhere(fn ($query) => $query->where('blocker_id', $other->id)->where('blocked_id', $this->id))
            ->exists();
    }

    public function hasUsername(): bool
    {
        return $this->username !== null;
    }

    /**
     * Profile setup can be skipped (AUTH-09): a saved name counts, and so does any PATCH me/profile, even an empty one.
     */
    public function hasCompletedProfileSetup(): bool
    {
        return $this->getAttribute('display_name') !== null || $this->getAttribute('profile_setup_at') !== null;
    }

    /**
     * Where the app resumes after a restart (F1): the first step still open, null when onboarding is done.
     */
    public function onboardingStep(): ?OnboardingStep
    {
        return match (true) {
            ! $this->hasVerifiedEmail() => OnboardingStep::VerifyEmail,
            ! $this->hasUsername() => OnboardingStep::ChooseUsername,
            ! $this->hasCompletedProfileSetup() => OnboardingStep::ProfileSetup,
            default => null,
        };
    }

    /**
     * When the next username change is possible; null when one is possible now.
     */
    public function usernameChangeAvailableAt(): ?CarbonImmutable
    {
        $changed = $this->getAttribute('username_changed_at');

        if (! $changed instanceof DateTimeInterface) {
            return null;
        }

        $next = CarbonImmutable::instance($changed)->addDays(config()->integer('speedclub.usernames.change_cooldown_days'));

        return $next->isFuture() ? $next : null;
    }

    private function isInForce(string $key): bool
    {
        if (! isset($this->restrictions[$key])) {
            return false;
        }

        $end = $this->endOf($key);

        return $end === null || $end->isFuture();
    }

    /**
     * Null means no end date, so anything that is not clearly a date keeps the restriction in force: fail closed. Carbon
     * alone would read an empty string as now and "tomorrow" as a date, and roll 31 February over.
     */
    private function endOf(string $key): ?CarbonImmutable
    {
        $until = $this->restrictions[$key]['until'] ?? null;

        if (! is_string($until) || preg_match('/\A(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\z/', $until, $date) !== 1) {
            return null;
        }

        if (! checkdate((int) $date[2], (int) $date[3], (int) $date[1])) {
            return null;
        }

        try {
            return CarbonImmutable::parse($until);
        } catch (InvalidFormatException) {
            return null;
        }
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function avatar(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'avatar_media_id');
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function cover(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'cover_media_id');
    }

    /**
     * @return HasMany<Vehicle, $this>
     */
    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class, 'owner_id');
    }

    /**
     * @return HasMany<Media, $this>
     */
    public function media(): HasMany
    {
        return $this->hasMany(Media::class, 'owner_id');
    }

    /**
     * @return HasMany<PushToken, $this>
     */
    public function pushTokens(): HasMany
    {
        return $this->hasMany(PushToken::class);
    }

    /**
     * @return HasMany<KnownDevice, $this>
     */
    public function knownDevices(): HasMany
    {
        return $this->hasMany(KnownDevice::class);
    }

    /**
     * @return HasMany<VerificationCode, $this>
     */
    public function verificationCodes(): HasMany
    {
        return $this->hasMany(VerificationCode::class);
    }

    /**
     * Members this member follows.
     *
     * @return BelongsToMany<self, $this>
     */
    public function following(): BelongsToMany
    {
        return $this->belongsToMany(self::class, 'follows', 'follower_id', 'followee_id')->withPivot('created_at');
    }

    /**
     * Members who follow this member.
     *
     * @return BelongsToMany<self, $this>
     */
    public function followers(): BelongsToMany
    {
        return $this->belongsToMany(self::class, 'follows', 'followee_id', 'follower_id')->withPivot('created_at');
    }

    /**
     * Members this member has blocked. Use hasBlockWith() to check a pair in either direction.
     *
     * @return BelongsToMany<self, $this>
     */
    public function blockedUsers(): BelongsToMany
    {
        return $this->belongsToMany(self::class, 'blocks', 'blocker_id', 'blocked_id')->withPivot('created_at', 'blocked_username');
    }

    /**
     * @return HasMany<Save, $this>
     */
    public function saves(): HasMany
    {
        return $this->hasMany(Save::class);
    }

    /**
     * @return BelongsToMany<Vehicle, $this>
     */
    public function savedVehicles(): BelongsToMany
    {
        return $this->belongsToMany(Vehicle::class, 'saves')->withPivot('created_at');
    }

    /**
     * @return HasMany<DataExport, $this>
     */
    public function dataExports(): HasMany
    {
        return $this->hasMany(DataExport::class);
    }

    /**
     * @return HasMany<SupportTicket, $this>
     */
    public function supportTickets(): HasMany
    {
        return $this->hasMany(SupportTicket::class);
    }

    /**
     * @return HasMany<CatalogRequest, $this>
     */
    public function catalogRequests(): HasMany
    {
        return $this->hasMany(CatalogRequest::class);
    }
}
