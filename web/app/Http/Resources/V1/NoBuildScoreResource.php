<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET vehicles/{id}/build-score while no score could be computed yet: `{"data": null}` (the app shows the pending state).
 */
class NoBuildScoreResource extends JsonResource
{
    /** @var string|null */
    public static $wrap = null;

    public function __construct()
    {
        parent::__construct(null);
    }

    /**
     * @return array{data: null}
     */
    public function toArray(Request $request): array
    {
        return ['data' => null];
    }
}
