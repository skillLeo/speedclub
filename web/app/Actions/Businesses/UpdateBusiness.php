<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessStatus;
use App\Models\Business;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BIZ-03 "Profil bearbeiten" (09 §8.10). While applied or rejected, everything can change. Once staff verified the business (also
 * while suspended), the identity and Impressum fields they checked are locked (422 naming the fields): those change through support,
 * so a verified badge never stands on data nobody checked. SEC-414-06: the Impressum's contact (e-mail, phone), the website, the
 * "Route" point and the kind lock too (Business::lockedFields). Profile fields (about, services, hours, logo, cover) stay open. Sending
 * a locked field unchanged is fine (a form that sends everything).
 */
class UpdateBusiness
{
    /**
     * @param  array<string, mixed>  $data  validated UpdateBusinessRequest data
     */
    public function handle(Business $business, array $data): Business
    {
        return DB::transaction(function () use ($business, $data): Business {
            /** @var Business $locked */
            $locked = Business::query()->whereKey($business->id)->lockForUpdate()->firstOrFail();

            if (in_array($locked->status, [BusinessStatus::Verified, BusinessStatus::Suspended], true)) {
                $changed = array_values(array_filter(Business::lockedFields(), fn (string $key): bool => array_key_exists($key, $data)
                    && self::normalise($key, $locked->getAttribute($key)) !== self::normalise($key, $data[$key])));

                if ($changed !== []) {
                    throw ValidationException::withMessages(array_fill_keys($changed, [(string) __('parts.identity_locked')]));
                }
            }

            BusinessFields::fill($locked, $data);
            $locked->save();

            return $locked;
        });
    }

    /**
     * One comparable form of a stored and a sent value: enums by value, blank as empty, e-mail case-insensitive, points to 6 decimals
     * (the column's precision).
     */
    private static function normalise(string $key, mixed $value): string
    {
        $value = $value instanceof \BackedEnum ? $value->value : $value;

        if (in_array($key, ['lat', 'lng'], true)) {
            return is_numeric($value) ? number_format((float) $value, 6, '.', '') : '';
        }

        $text = is_scalar($value) ? trim((string) $value) : '';

        return $key === 'email' ? mb_strtolower($text) : $text;
    }
}
