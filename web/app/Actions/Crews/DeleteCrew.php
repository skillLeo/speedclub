<?php

namespace App\Actions\Crews;

use App\Enums\CrewAuditEvent;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\Media;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Crews\CrewNames;
use App\Services\Media\MediaService;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * DELETE crews/{slug} (contract-crews.md §3 #12): the founder deletes the crew after typing its name. Memberships, requests and
 * invitations go (with their notification rows), the name is free again, the slug never. Logo and cover stop being served at once (their
 * public files go); the row with their private originals stays soft-deleted for the audit trail and any open case, until crews:prune
 * (CrewPurge). Also open on a hidden crew.
 */
class DeleteCrew
{
    public function __construct(private readonly MediaService $media, private readonly Notifier $notifier) {}

    public function handle(User $founder, Crew $crew, string $confirmName): void
    {
        if (CrewNames::key($confirmName) !== CrewNames::key($crew->name)) {
            throw ValidationException::withMessages(['confirm_name' => [(string) __('crews.confirm_name_mismatch')]]);
        }

        [$requests, $invites, $media] = DB::transaction(function () use ($founder, $crew): array {
            Crew::query()->whereKey($crew->id)->lockForUpdate()->value('id');
            $requests = CrewRequest::query()->where('crew_id', $crew->id)->pluck('id')->all();
            $invites = CrewInvite::query()->where('crew_id', $crew->id)->pluck('id')->all();
            CrewRequest::query()->where('crew_id', $crew->id)->delete();
            CrewInvite::query()->where('crew_id', $crew->id)->delete();
            $members = CrewMember::query()->where('crew_id', $crew->id)->count();
            CrewMember::query()->where('crew_id', $crew->id)->delete();
            $media = array_values(array_filter([$crew->logo_media_id, $crew->cover_media_id]));

            // Logo and cover stay attached: crews:prune deletes them with the row (CrewPurge), never while a case is open.
            $crew->forceFill(['name_key' => null, 'members_count' => 0])->save();
            $crew->delete();
            Audit::record(CrewAuditEvent::Deleted->value, $crew, ['name' => $crew->name, 'members' => $members], null, actor: $founder);

            return [$requests, $invites, $media];
        });

        foreach ($requests as $id) {
            $this->notifier->forgetCrew((string) $id, 'request_received');
        }

        foreach ($invites as $id) {
            $this->notifier->forgetCrew((string) $id, 'invited');
        }

        $this->notifier->forgetCrew($crew->id, 'request_approved');

        // Nobody may see them any more: the public files go now, the private originals wait for the purge.
        foreach (Media::query()->whereIn('id', $media)->get() as $photo) {
            $this->media->withdraw($photo);
        }
    }
}
