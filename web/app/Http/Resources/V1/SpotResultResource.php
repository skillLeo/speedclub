<?php

namespace App\Http\Resources\V1;

use App\Services\Dex\SpotCard;
use App\Services\Dex\SpotOutcome;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer of POST spots and GET spots/{spot} (m5.9b contract §2, §3): the SpotCard in `data`, what the spot did in `meta`.
 * POST answers 201 for a new spot and 200 for the same car again within 24 h (`meta.duplicate`).
 *
 * @property SpotOutcome $resource
 */
class SpotResultResource extends JsonResource
{
    public function __construct(SpotOutcome $outcome, private readonly SpotCard $card, private readonly bool $created = false)
    {
        parent::__construct($outcome);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return (new SpotCardResource($this->card))->toArray($request);
    }

    /**
     * @return array{meta: array{new_in_dex: bool, duplicate: bool, first_spotter: bool, counted: bool, reason: 'account_too_new'|'sample_car'|null, set_progress: list<array{key: string, name: string, progress: int, target: int, completed: bool}>}}
     */
    public function with(Request $request): array
    {
        $outcome = $this->resource;

        return ['meta' => [
            'new_in_dex' => $outcome->newInDex,
            'duplicate' => $outcome->duplicate,
            'first_spotter' => $outcome->firstSpotter,
            /** False for an account younger than 24 h and for a real member's scan of a sample car: the scan worked, nothing counts. */
            'counted' => $outcome->spot->counted,
            /** With `counted` false: "account_too_new", or "sample_car" (a "Beispiel" car never counts for a real member). */
            'reason' => $outcome->reason,
            'set_progress' => $outcome->setProgress,
        ]];
    }

    public function withResponse(Request $request, JsonResponse $response): void
    {
        $response->setStatusCode($this->created ? 201 : 200);
    }
}
