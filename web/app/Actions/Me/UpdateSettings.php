<?php

namespace App\Actions\Me;

use App\Models\User;
use App\Services\Events\EventLocation;
use App\Services\Maintenance\MaintenancePrefs;
use App\Services\PublicPages\SitemapWriter;
use Illuminate\Support\Facades\DB;

class UpdateSettings
{
    public function __construct(private readonly SitemapWriter $sitemap) {}

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function handle(User $user, array $attributes): User
    {
        $prefs = $attributes['notification_prefs'] ?? null;
        $maintenance = $attributes['maintenance'] ?? null;
        $region = array_key_exists('home_region', $attributes) ? ['given' => $attributes['home_region']] : null;
        unset($attributes['notification_prefs'], $attributes['maintenance'], $attributes['home_region']);

        // SET-11 "System": the app follows the device; mails and pushes use the device's language as this request names it.
        $followsSystem = null;

        if (array_key_exists('locale', $attributes)) {
            $followsSystem = $attributes['locale'] === 'system';
            $attributes['locale'] = $followsSystem ? app()->getLocale() : $attributes['locale'];
        }

        DB::transaction(function () use ($user, $attributes, $prefs, $maintenance, $region, $followsSystem): void {
            // Under the row lock, so two quick toggles of SET-09 each keep the other's change.
            $current = User::query()->whereKey($user->id)->lockForUpdate()->value('notification_prefs');
            $user->fill($attributes);

            if ($followsSystem !== null) {
                $user->forceFill(['locale_follows_system' => $followsSystem]);
            }

            if ($region !== null) {
                $this->setRegion($user, $region['given']);
            }

            if (is_array($maintenance)) {
                // M4.13 SET-23: like SET-09, only what the member changed is stored (MaintenancePrefs merges the defaults when reading).
                $stored = User::query()->whereKey($user->id)->value('maintenance_prefs');
                $stored = is_string($stored) ? json_decode($stored, true) : $stored;

                if (is_array($maintenance['hu_au_lead_days'] ?? null)) {
                    $maintenance['hu_au_lead_days'] = MaintenancePrefs::leadDays($maintenance['hu_au_lead_days']);
                }

                $user->setAttribute('maintenance_prefs', array_replace(is_array($stored) ? $stored : [], $maintenance));
            }

            if (is_array($prefs)) {
                $stored = is_string($current) ? json_decode($current, true) : $current;
                // Only what the member changed is stored, never the defaults, so a default changed later still reaches everybody who never
                // touched it (M2.2 review #9). The request admits known keys only; for() merges the defaults when reading.
                $user->setAttribute('notification_prefs', array_replace_recursive(is_array($stored) ? $stored : [], $prefs));
            }

            $user->save();
        });

        // Search engines off: the profile and the vehicles leave the sitemap now, not with the night.
        if ($user->wasChanged('indexable') && $user->getAttribute('indexable') === false) {
            $this->sitemap->forget();
        }

        return $user;
    }

    /**
     * The home region of SET-11: the label as picked, the point snapped to the 0.05° grid of event areas (EventLocation::area), so
     * not even the stored value narrows a street down. Null clears it.
     */
    private function setRegion(User $user, mixed $region): void
    {
        if (! is_array($region)) {
            $user->forceFill(['home_region_label' => null, 'home_region_lat' => null, 'home_region_lng' => null]);

            return;
        }

        [$lat, $lng] = EventLocation::area((float) $region['lat'], (float) $region['lng']);
        $user->forceFill(['home_region_label' => trim((string) $region['label']), 'home_region_lat' => $lat, 'home_region_lng' => $lng]);
    }
}
