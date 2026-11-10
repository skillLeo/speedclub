<?php

namespace App\Models;

use Database\Factories\KnownDeviceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A device an account has signed in from, as a checksum only. Decides whether a login triggers the security e-mail.
 */
#[Fillable(['user_id', 'fingerprint', 'last_seen_at'])]
class KnownDevice extends Model
{
    /** @use HasFactory<KnownDeviceFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
