<?php

namespace App\Http\Controllers\Api\V1\Dex;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\RarityRulesResource;
use App\Services\Dex\RarityRules;

/**
 * "So funktioniert Seltenheit" (m5.9b contract §3, §10).
 */
class RarityRulesController extends Controller
{
    /**
     * Rarity rules.
     *
     * The thresholds of the rarity tiers: Tuned (Build Score), Rare (public cars of the same generation), Legend (Build Score or the
     * only public car of its generation), Ghost (the owner's opt-in). Guests too.
     *
     * @unauthenticated
     */
    public function __invoke(RarityRules $rules): RarityRulesResource
    {
        return new RarityRulesResource($rules->thresholds());
    }
}
