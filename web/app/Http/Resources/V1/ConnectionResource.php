<?php

namespace App\Http\Resources\V1;

use App\Models\User;
use App\Support\Viewer;
use Illuminate\Http\Request;

/**
 * A row of PROF-04: the member summary, whether the row is the viewer, and whether the viewer follows it (for the trailing
 * Folgen / Folge ich). From App\Services\Social\Connections, which sets `viewer_follows` for the whole page in one query.
 *
 * @property User $resource
 */
class ConnectionResource extends MemberSummaryResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $member = $this->resource;

        return [
            ...parent::toArray($request),
            'is_self' => Viewer::from($request)?->is($member) ?? false,
            /** The viewer follows this member. False for guests. */
            'is_following' => $member->getAttribute('viewer_follows') === true,
        ];
    }
}
