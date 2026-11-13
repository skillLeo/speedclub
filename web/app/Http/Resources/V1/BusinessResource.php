<?php

namespace App\Http\Resources\V1;

use App\Enums\BusinessRole;
use App\Models\Business;
use App\Services\Businesses\BusinessHours;
use App\Services\Businesses\BusinessImpressum;
use App\Support\Viewer;
use Illuminate\Http\Request;

/**
 * BIZ-01 Betriebsprofil ★ (09 §7.11) and the data of WEB-10 /b/{slug}: cover 16:9, logo, name, "Werkstatt · München" + Verifiziert,
 * services, opening hours (today marked, Europe/Berlin), address + point for "Route", contact ("Nachricht" goes to the owner's
 * account), the real number of builds in the portfolio and the Impressum block (§ 5 DDG). The portfolio wall follows from
 * `businesses/{slug}/portfolio`.
 *
 * @property Business $resource
 */
class BusinessResource extends BusinessCardResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $business = $this->resource;
        $owner = $business->owner;
        $role = $business->roleOf(Viewer::from($request));

        return [
            ...parent::toArray($request),
            'cover' => self::photo($business->cover),
            /** @var string|null */
            'about' => $business->about,
            /**
             * Monday first; `ranges` empty = closed; `today` in Europe/Berlin.
             *
             * @var list<array{day: string, ranges: list<array{opens: string, closes: string}>, today: bool}>
             */
            'opening_hours' => BusinessHours::week($business->opening_hours),
            /** @var array{street: string, postcode: string, city: string, country: string, lat: float|null, lng: float|null} */
            'address' => [
                'street' => $business->street,
                'postcode' => $business->postcode,
                'city' => $business->city,
                'country' => $business->country,
                'lat' => $business->lat,
                'lng' => $business->lng,
            ],
            /**
             * `message_username`: "Nachricht" opens a conversation with this account (the business owner); null when it has no username.
             *
             * @var array{phone: string|null, email: string, website: string|null, message_username: string|null}
             */
            'contact' => [
                'phone' => $business->phone,
                'email' => $business->email,
                'website' => $business->website,
                'message_username' => $owner->username,
            ],
            /** Builds in "Builds aus unserer Werkstatt" (both sides confirmed), a real count; null on a sample (09 §8.19). */
            'portfolio_count' => $business->is_sample ? null : $business->portfolioCount,
            /** § 5 DDG; on a sample its data is a placeholder (`is_sample`). */
            'impressum' => BusinessImpressum::for($business),
            /**
             * The reader's role in the team ("owner", "staff"), null for everybody else: the app shows "Bearbeiten" and BIZ-03.
             *
             * @var BusinessRole|null
             */
            'viewer_role' => $role,
        ];
    }
}
