<?php

namespace App\Http\Resources\V1\Crews;

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Http\Resources\V1\MediaResource;
use App\Http\Resources\V1\MemberSummaryResource;
use App\Models\Crew;
use App\Models\User;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;

/**
 * CREW-01 (contract-crews.md §2 Crew): the card's fields plus status, founder and what the reader may do. A status other than active
 * reaches only the crew's own members. Open request and invitation counts only for founder and admins.
 *
 * @property Crew $resource
 */
class CrewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $crew = $this->resource;
        $reader = Viewer::from($request);
        $founder = $crew->founder();
        $viewer = $crew->viewer;
        $role = $viewer['role'] ?? null;
        $state = $viewer['state'] ?? 'none';
        $active = $crew->status === CrewStatus::Active;
        $runs = $role?->runsCrew() ?? false;

        return [
            'id' => $crew->id,
            'slug' => $crew->slug,
            'name' => $crew->name,
            /** @var string|null */
            'description' => $crew->description,
            /** @var string|null */
            'bundesland' => $crew->bundesland?->value,
            /** @var string|null */
            'bundesland_label' => $crew->bundesland?->label(),
            /** @var CrewJoinMode */
            'join_mode' => $crew->join_mode,
            /** How many members the crew has: shown, never sorted by. */
            'member_count' => $crew->members_count,
            /** @var MediaResource|null */
            'logo' => CrewCardResource::photo($crew->logo),
            /** @var MediaResource|null */
            'cover' => CrewCardResource::photo($crew->cover),
            'is_sample' => $crew->is_sample,
            'share_path' => '/crews/'.$crew->slug,
            /**
             * `hidden` (staff hid it; only its members see the crew) or `removed`; `active` for everybody else.
             *
             * @var CrewStatus
             */
            'status' => $crew->status,
            'created_at' => $crew->created_at?->toIso8601String(),
            /**
             * Null when the reader may not see the founder (a block, a suspended account).
             *
             * @var MemberSummaryResource|null
             */
            'founder' => $founder instanceof User && Gate::forUser($reader)->allows('view', $founder) ? new MemberSummaryResource($founder) : null,
            /**
             * The reader's role, state, open invitation or request and what they may do; null for guests.
             *
             * @var array{role: 'founder'|'admin'|'member'|null, state: 'member'|'requested'|'invited'|'none', invite_id: string|null, request_id: string|null, can: array{edit: bool, invite: bool, approve: bool, manage_members: bool, hand_over: bool, delete: bool, join: bool, request: bool, leave: bool}}|null
             */
            'viewer' => $viewer === null ? null : [
                'role' => $role?->value,
                'state' => $state,
                'invite_id' => $viewer['invite_id'],
                'request_id' => $viewer['request_id'],
                'can' => [
                    'edit' => $active && $runs,
                    'invite' => $active && $runs,
                    'approve' => $active && $runs,
                    'manage_members' => $runs,
                    'hand_over' => $active && $role === CrewRole::Founder,
                    'delete' => $role === CrewRole::Founder,
                    'join' => $active && $role === null && ($state === 'invited' || $crew->join_mode === CrewJoinMode::Open),
                    'request' => $active && $role === null && $state === 'none' && $crew->join_mode === CrewJoinMode::Request,
                    'leave' => $role !== null && $role !== CrewRole::Founder,
                ],
            ],
            /** Open join requests; founder and admins only, else null. */
            'pending_requests_count' => $runs ? $crew->pendingRequests : null,
            /** Open invitations; founder and admins only, else null. */
            'open_invites_count' => $runs ? $crew->openInvites : null,
        ];
    }
}
