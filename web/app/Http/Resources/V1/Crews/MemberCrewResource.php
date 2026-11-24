<?php

namespace App\Http\Resources\V1\Crews;

use App\Enums\CrewRole;
use Illuminate\Http\Request;

/**
 * A crew on a member's profile (PROF-01/02 crew chips; GET public/users/{username}/crews): the card plus the member's role in it.
 */
class MemberCrewResource extends CrewCardBase
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $role = $this->resource->getAttribute('member_role');

        return [
            ...parent::toArray($request),
            /**
             * The profile member's role in the crew.
             *
             * @var CrewRole
             */
            'role' => is_string($role) ? CrewRole::from($role) : CrewRole::Member,
        ];
    }
}
