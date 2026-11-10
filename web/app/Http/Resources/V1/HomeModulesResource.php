<?php

namespace App\Http\Resources\V1;

use App\Models\BuildUpdate;
use App\Services\Home\ActiveMember;
use App\Services\Home\PopularMod;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The FS-2 modules of HOME-01 between "Neue Builds" and the stream. An empty list hides its section.
 *
 * @property array{build_updates: list<BuildUpdate>, active_members: list<ActiveMember>, popular_mods: list<PopularMod>} $resource
 */
class HomeModulesResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * At most 3, newest first; at most one per build and two per owner.
             *
             * @var list<BuildUpdateRowResource>
             */
            'build_updates' => BuildUpdateRowResource::collection($this->resource['build_updates']),
            /**
             * At most 12, most recently active first.
             *
             * @var list<ActiveMemberResource>
             */
            'active_members' => ActiveMemberResource::collection($this->resource['active_members']),
            /**
             * At most 12, most built first.
             *
             * @var list<PopularModResource>
             */
            'popular_mods' => PopularModResource::collection($this->resource['popular_mods']),
        ];
    }
}
