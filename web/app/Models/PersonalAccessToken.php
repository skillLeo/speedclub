<?php

namespace App\Models;

use App\Enums\DevicePlatform;
use Database\Factories\PersonalAccessTokenFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Laravel\Sanctum\PersonalAccessToken as SanctumPersonalAccessToken;

/**
 * One token per device, with what SET-06 lists about it (02_PRODUCT_SPEC §3.1).
 *
 * @property int $id
 * @property string $tokenable_type
 * @property string $tokenable_id
 */
class PersonalAccessToken extends SanctumPersonalAccessToken
{
    /** @use HasFactory<PersonalAccessTokenFactory> */
    use HasFactory;

    /**
     * @var array<int, string>
     */
    protected $fillable = ['name', 'token', 'abilities', 'expires_at', 'device_name', 'device_id', 'platform', 'app_version'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['platform' => DevicePlatform::class];
    }

    /**
     * What the device calls itself. Older tokens have only the name they were created with.
     */
    public function deviceName(): string
    {
        $device = $this->getAttribute('device_name');
        $name = $this->getAttribute('name');

        return is_string($device) ? $device : (is_string($name) ? $name : 'device');
    }

    /**
     * The app's per-install id, when the sign-in or a later rotation sent one.
     */
    public function deviceId(): ?string
    {
        $id = $this->getAttribute('device_id');

        return is_string($id) && $id !== '' ? $id : null;
    }

    /**
     * Every token of this member on this device, this one included. There is one, and for the moments after a rotation
     * (RotateMemberToken) two: the replaced token and what replaced it.
     *
     * With a device_id, the device is that install, whatever its model. Without one (older app builds), it goes by name and platform:
     * an older token by its name (deviceName), and what replaced it has that name as its device_name. Such a token never reaches a
     * token with a device_id, so an older app on one phone cannot sign out a newer one of the same model.
     *
     * @return Builder<self>
     */
    public function onSameDevice(): Builder
    {
        $query = self::query()
            ->where('tokenable_type', $this->tokenable_type)
            ->where('tokenable_id', $this->tokenable_id);

        $id = $this->deviceId();

        if ($id !== null) {
            return $query->where(fn (Builder $device) => $device->where('device_id', $id)->orWhereKey($this->getKey()));
        }

        return $query
            ->where('platform', $this->getRawOriginal('platform'))
            ->where(fn (Builder $device) => $device
                ->where(fn (Builder $named) => $named
                    ->whereNull('device_id')
                    ->where(fn (Builder $name) => $name
                        ->where('device_name', $this->deviceName())
                        ->orWhere(fn (Builder $older) => $older->whereNull('device_name')->where('name', $this->deviceName()))))
                ->orWhereKey($this->getKey()));
    }
}
