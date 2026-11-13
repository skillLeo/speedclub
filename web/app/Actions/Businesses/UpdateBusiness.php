<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessStatus;
use App\Models\Business;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BIZ-03 "Profil bearbeiten" (09 §8.10). While applied or rejected, everything can change. Once staff verified the business (also
 * while suspended), the identity and Impressum fields they checked are locked (422 naming the fields): those change through support,
 * so a verified badge never stands on data nobody checked. Profile fields (about, services, hours, contact, website, point) stay open.
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
                $changed = array_values(array_filter(Business::IDENTITY, function (string $key) use ($data, $locked): bool {
                    if (! array_key_exists($key, $data)) {
                        return false;
                    }

                    $current = $locked->getAttribute($key);
                    $current = $current instanceof \BackedEnum ? $current->value : $current;

                    return (string) $current !== (string) $data[$key];
                }));

                if ($changed !== []) {
                    throw ValidationException::withMessages(array_fill_keys($changed, [(string) __('parts.identity_locked')]));
                }
            }

            BusinessFields::fill($locked, $data);
            $locked->save();

            return $locked;
        });
    }
}
