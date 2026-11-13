<?php

namespace App\Models;

use App\Enums\DevicePlatform;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityActivity;
use Database\Factories\SecurityEventFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A row of member_security_events (09 §8.4), written next to its audit event by SecurityEventLog. SET-21 lists those with a
 * SecurityActivity. Kept 12 months (PrunePlatformDataCommand). No IP address (ADR-113).
 *
 * @property string $id
 * @property string $user_id
 * @property MemberSecurityEvent $type
 * @property string|null $device_install_id
 * @property string|null $device_name
 * @property DevicePlatform|null $platform
 * @property string|null $approx_city
 * @property array<string, mixed>|null $meta
 * @property Carbon $created_at
 * @property Carbon|null $secured_at the account was secured with this or a later event's link (single use, SEC-M47-05)
 */
class SecurityEvent extends Model
{
    /** @use HasFactory<SecurityEventFactory> */
    use HasFactory, HasUlids;

    protected $table = 'member_security_events';

    public const UPDATED_AT = null;

    /**
     * @var list<string>
     */
    protected $fillable = ['type', 'device_name', 'platform', 'approx_city', 'meta'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['type' => MemberSecurityEvent::class, 'platform' => DevicePlatform::class, 'meta' => 'array', 'created_at' => 'datetime', 'secured_at' => 'datetime'];
    }

    public function activity(): ?SecurityActivity
    {
        return SecurityActivity::fromEvent($this->type);
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeShown(Builder $query): Builder
    {
        return $query->whereIn('type', SecurityActivity::shownEvents());
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<DeviceInstall, $this>
     */
    public function deviceInstall(): BelongsTo
    {
        return $this->belongsTo(DeviceInstall::class);
    }
}
