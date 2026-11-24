<?php

namespace App\Models;

use App\Enums\DevicePlatform;
use Database\Factories\DeviceInstallFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One app install of one member (09 §8.4). The install id the app keeps in SecureStore is stored only as a keyed hash
 * (DeviceInstalls::key, keyed with the member too), so the table cannot be matched against another member's install. No IP address.
 * Exception (ADR-511): install_key (DeviceInstalls::installKey, without the member) lets the Spots admin see several spotting accounts on
 * one install; only App\Services\Admin\Spots\SharedDevices reads it, and it is in no API answer, export or admin page.
 *
 * @property string $id
 * @property string $user_id
 * @property string $install_id_hash
 * @property string|null $install_key
 * @property DevicePlatform|null $platform
 * @property string|null $model
 * @property string|null $os_version
 * @property string|null $app_version
 * @property string|null $approx_city
 * @property Carbon $first_seen_at
 * @property Carbon $last_seen_at
 */
class DeviceInstall extends Model
{
    /** @use HasFactory<DeviceInstallFactory> */
    use HasFactory, HasUlids;

    public $timestamps = false;

    /**
     * @var list<string>
     */
    protected $hidden = ['install_key'];

    /**
     * @var list<string>
     */
    protected $fillable = ['platform', 'model', 'os_version', 'app_version', 'approx_city', 'first_seen_at', 'last_seen_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['platform' => DevicePlatform::class, 'first_seen_at' => 'datetime', 'last_seen_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
