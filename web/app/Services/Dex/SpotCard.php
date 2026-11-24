<?php

namespace App\Services\Dex;

use App\Models\Spot;
use App\Models\Vehicle;

/**
 * One card of STREET DEX (m5.9b contract §2 SpotCard, §10): the car as the viewer sees it on DEX-01/03/04/05, with the viewer's spot
 * (null for the DEX-04 "noch nicht gespottet" preview). Presented by App\Http\Resources\V1\SpotCardResource; the vehicle carries the
 * relations of SpotCards::RELATIONS.
 */
final readonly class SpotCard
{
    /** The spot's id under the name GET me/dex orders and pages by: its cursor reads it from the page's items. */
    public ?string $spot_id;

    public function __construct(
        public Vehicle $vehicle,
        public ?Spot $spot,
        public bool $firstSpotter,
    ) {
        $this->spot_id = $spot?->id;
    }
}
