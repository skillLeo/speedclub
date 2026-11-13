<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdatePresenter;
use App\Services\Social\ViewerStates;
use App\Support\Viewer;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;

/**
 * A build in a list of HOME-01, DISC-01 and DISC-02: the vehicle card plus the owner row and the latest change
 * (02_PRODUCT_SPEC §1.2, 03_DESIGN_SYSTEM §8 "Vehicle card"). No like or view counts exist, and none are invented.
 *
 * @property Vehicle $resource
 */
class FeedVehicleResource extends VehicleCardResource
{
    /** What toArray reads; load it for a list, with withCount('modifications'). */
    public const RELATIONS = [...VehicleCardResource::RELATIONS, 'owner.avatar', 'latestVisibleUpdate'];

    /** A card has one line for the change: two rendered, the rest as "3 weitere". */
    private const CARD_CHANGES = 2;

    /**
     * M4.8: every card registers its build, so the reader's states of a whole list load in one go (ViewerStates).
     */
    public function __construct($resource)
    {
        parent::__construct($resource);

        if ($resource instanceof Vehicle) {
            ViewerStates::register('vehicle', (string) $resource->id);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $viewer = Viewer::from($request);
        $owner = $vehicle->owner;
        $update = $vehicle->latestVisibleUpdate;

        return [
            ...parent::toArray($request),
            /**
             * The owner row. Null for everybody but the owner when the owner asked not to be named on the vehicle page
             * (`show_owner_on_qr`, ADR-148 a), so a card does not name who the page itself hides.
             */
            'owner' => $owner instanceof User && ($vehicle->isOwnedBy($viewer) || $owner->getAttribute('show_owner_on_qr') !== false)
                ? new MemberSummaryResource($owner)
                : null,
            /**
             * The newest entry of Verlauf that is not hidden, in one line: "Fahrwerk: Serie → KW V3 · −35 mm".
             *
             * @var array{id: string, type_label: string, summary: string, created_at: string|null}|null
             */
            'latest_update' => $update instanceof BuildUpdate ? $this->latestUpdate($update, $viewer) : null,
            /**
             * M4.8: the reader's own state on this build: saved in one of their collections, their private reaction
             * ("strong" | "clean" | "low" | "loud", null while build_reactions is off). Null for guests. Never anybody else's, never a count.
             *
             * @var array{saved: bool, reaction: string|null}|null
             */
            'viewer' => $viewer === null ? null : app(ViewerStates::class)->of($viewer, 'vehicle', (string) $vehicle->id),
        ];
    }

    /**
     * @return array{id: string, type_label: string, summary: string, created_at: string|null}
     */
    private function latestUpdate(BuildUpdate $update, ?User $viewer): array
    {
        $locale = app()->getLocale();
        $presenter = app(BuildUpdatePresenter::class);
        $changes = $presenter->changes($update, Viewer::powerDisplay($viewer), $locale, self::CARD_CHANGES);
        $created = $update->getAttribute('created_at');

        return [
            'id' => (string) $update->getKey(),
            'type_label' => $presenter->typeLabel($update, $locale),
            'summary' => $presenter->summary($update, $changes, $locale),
            'created_at' => $created instanceof CarbonInterface ? $created->toIso8601String() : null,
        ];
    }
}
