<?php

namespace App\Http\Resources\V1;

use App\Models\Vehicle;
use Illuminate\Http\Request;

/**
 * The answer to PUT vehicles/{id}/specs: the owner's vehicle, and what the client may tell the member about Verlauf.
 *
 * @property Vehicle $resource
 */
class VehicleSpecsSavedResource extends VehicleResource
{
    public function __construct(Vehicle $vehicle, private readonly bool $historyRecorded)
    {
        parent::__construct($vehicle);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...parent::toArray($request),
            /**
             * Whether Verlauf now tells about this save. Decides between "Gespeichert" and "Im Verlauf erscheint ein Eintrag".
             *
             * @var bool
             */
            'history_recorded' => $this->historyRecorded,
        ];
    }
}
