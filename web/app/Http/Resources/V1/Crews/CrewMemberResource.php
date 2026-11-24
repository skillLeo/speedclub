<?php

namespace App\Http\Resources\V1\Crews;

use App\Enums\CrewRole;
use App\Http\Resources\V1\MemberSummaryResource;
use App\Http\Resources\V1\VehicleCardResource;
use App\Models\CrewMember;
use App\Models\Vehicle;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of CREW-01's member list (contract-crews.md §2 CrewMember): the member, their role, when they joined and up to
 * vehicles_per_member of their public builds (CrewListing::attachVehicles).
 *
 * @property CrewMember $resource
 */
class CrewMemberResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $member = $this->resource;
        /** @var list<Vehicle> $vehicles */
        $vehicles = is_array($member->getAttribute('crew_vehicles')) ? $member->getAttribute('crew_vehicles') : [];

        return [
            'member' => new MemberSummaryResource($member->user),
            /** @var CrewRole */
            'role' => $member->role,
            'joined_at' => $member->joined_at->toIso8601String(),
            'is_self' => Viewer::from($request)?->is($member->user) ?? false,
            /**
             * Public, published builds of the member, main first.
             *
             * @var list<VehicleCardResource>
             */
            'vehicles' => array_map(fn (Vehicle $vehicle): VehicleCardResource => new VehicleCardResource($vehicle), $vehicles),
        ];
    }
}
