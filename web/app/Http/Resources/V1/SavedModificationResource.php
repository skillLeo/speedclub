<?php

namespace App\Http\Resources\V1;

use App\Models\Modification;
use Illuminate\Http\Request;

/**
 * The answer to PATCH mods/{id}: the modification, and what the client may tell the member about Verlauf.
 *
 * @property Modification $resource
 */
class SavedModificationResource extends ModificationResource
{
    public function __construct(Modification $modification, private readonly bool $historyRecorded)
    {
        parent::__construct($modification);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...parent::toArray($request),
            /**
             * Whether Verlauf now tells about this edit. Decides between "Gespeichert" and "Im Verlauf erscheint ein Eintrag".
             *
             * @var bool
             */
            'history_recorded' => $this->historyRecorded,
        ];
    }
}
