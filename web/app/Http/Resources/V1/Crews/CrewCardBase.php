<?php

namespace App\Http\Resources\V1\Crews;

use App\Enums\CrewJoinMode;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Http\Resources\V1\MediaResource;
use App\Models\Crew;
use App\Models\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The fields of a crew card (contract-crews.md §2 CrewCard), shared by CrewCardResource (CREW-00) and MemberCrewResource (profile
 * chips). A base of its own, never collected itself: Scramble types a subclass's collection() as its parent's once the parent's
 * collection() is called anywhere (see ConnectionResource). member_count is a fact on the card, never
 * an order (C2). `viewer` is the reader's role and state, null for guests.
 *
 * @property Crew $resource
 */
abstract class CrewCardBase extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $crew = $this->resource;

        return [
            'id' => $crew->id,
            /** Current slug; when a request named an older one, the client redirects to this. */
            'slug' => $crew->slug,
            'name' => $crew->name,
            /** @var string|null */
            'description' => $crew->description,
            /**
             * Two-letter code of the Bundesland, or null.
             *
             * @var string|null
             */
            'bundesland' => $crew->bundesland?->value,
            /**
             * "Bayern"; null without a Bundesland.
             *
             * @var string|null
             */
            'bundesland_label' => $crew->bundesland?->label(),
            /** @var CrewJoinMode */
            'join_mode' => $crew->join_mode,
            /** How many members the crew has: shown, never sorted by. */
            'member_count' => $crew->members_count,
            'logo' => self::photo($crew->logo),
            'cover' => self::photo($crew->cover),
            /** Sample content (09 §8.19): the "Beispiel" badge. */
            'is_sample' => $crew->is_sample,
            /** "/crews/nordlicht-crew" (the member web: /app/crews/…). */
            'share_path' => '/crews/'.$crew->slug,
            /**
             * The reader's relation to the crew; null for guests.
             *
             * @var array{role: 'founder'|'admin'|'member'|null, state: 'member'|'requested'|'invited'|'none'}|null
             */
            'viewer' => $crew->viewer === null ? null : [
                'role' => $crew->viewer['role']?->value,
                'state' => $crew->viewer['state'],
            ],
        ];
    }

    public static function photo(?Media $media): ?MediaResource
    {
        return $media instanceof Media && $media->status === MediaStatus::Ready && $media->moderation_status !== ModerationStatus::Rejected ? new MediaResource($media) : null;
    }
}
