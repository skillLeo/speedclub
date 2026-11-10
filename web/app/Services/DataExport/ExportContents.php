<?php

namespace App\Services\DataExport;

use App\Enums\DecisionAction;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Auth\DeviceSessions;
use App\Services\Notifications\NotificationPrefs;
use DateTimeInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What SET-12 hands over (GDPR Art. 15 and 20, m2.5-contract §3): the member's own data as JSON, other members by username only, never
 * an IP address (none is stored for members, ADR-113) and never a secret (password hash, two-factor key and codes, tokens). Photos
 * the member uploaded are listed in photos.json and copied as originals by the photo slices.
 *
 * The staff copy (SEC-P3-01: four-eyes members.export, data_exports.requested_by_staff_id set) leaves out what other members wrote or
 * sent: no message text, no chat photo, no reaction; per conversation only the partner, folder, dates and counts (like ADM-10's message
 * metadata). The member's own Art. 15 copy is SET-12's, never handed to staff.
 */
class ExportContents
{
    /** Morph names of what holds a chat photo (UploadMessagePhoto: the conversation, then the message). */
    private const CHAT_MEDIA = ['conversation', 'message'];

    /**
     * @return array<string, mixed> file name => JSON data, in the order of the ZIP
     */
    public function documents(User $user, bool $forStaff = false): array
    {
        return [
            'profile.json' => $this->profile($user),
            'settings.json' => $this->settings($user),
            'consents.json' => $this->consents($user),
            'vehicles.json' => $this->vehicles($user),
            'photos.json' => $this->photos($user, $forStaff),
            'follows.json' => $this->follows($user),
            'blocks.json' => $this->blocks($user),
            'saves.json' => $this->saves($user),
            'reports.json' => $this->reports($user),
            // M2.6: decisions about the member with their statements of reasons, and the member's own appeals; never who reported.
            'moderation_decisions.json' => $this->moderationDecisions($user),
            'appeals.json' => $this->appeals($user),
            'support_tickets.json' => $this->supportTickets($user, $forStaff),
            'devices.json' => $this->devices($user),
            // Fix round (review should-fix 10): the member's own security log, reactions, push installs and browser sessions.
            'security_events.json' => $this->securityEvents($user),
            'reactions.json' => $forStaff ? ['count' => $this->reactionCount($user)] : $this->reactions($user),
            'push_devices.json' => $this->pushDevices($user),
            'browser_sessions.json' => $this->browserSessions($user),
        ];
    }

    /**
     * Every photo with an original still on the private disk, deleted ones inside their 30 days included: they are still held.
     *
     * @return Builder
     */
    public function photoQuery(User $user, bool $forStaff = false)
    {
        return DB::table('media')
            ->where('owner_id', $user->getKey())
            ->whereNotNull('original_path')
            // The staff copy has no chat photos (SEC-P3-01): they belong to a conversation.
            ->when($forStaff, fn ($query) => $query->where(fn ($kind) => $kind->whereNull('mediable_type')->orWhereNotIn('mediable_type', self::CHAT_MEDIA)))
            ->orderBy('id');
    }

    public static function photoFile(string $mediaId, ?string $originalPath): string
    {
        $extension = strtolower(pathinfo((string) $originalPath, PATHINFO_EXTENSION));

        return 'photos/'.$mediaId.'.'.($extension !== '' ? $extension : 'jpg');
    }

    /**
     * @return array<string, mixed>
     */
    private function profile(User $user): array
    {
        return [
            'id' => $user->id,
            'email' => $user->email,
            'email_verified_at' => $this->date($user->getAttribute('email_verified_at')),
            'username' => $user->username,
            'previous_username' => $user->getAttribute('previous_username'),
            'username_changed_at' => $this->date($user->getAttribute('username_changed_at')),
            'display_name' => $user->getAttribute('display_name'),
            'city' => $user->getAttribute('city'),
            'bio' => $user->getAttribute('bio'),
            'avatar' => $this->photoRef($user->getAttribute('avatar_media_id')),
            'cover' => $this->photoRef($user->getAttribute('cover_media_id')),
            'status' => $this->value($user->getAttribute('status')),
            'restrictions' => $user->getAttribute('restrictions'),
            'member_since' => $this->date($user->created_at),
            'last_seen_at' => $this->date($user->getAttribute('last_seen_at')),
            // Where sign-up began (ADR-216): qr, public_vehicle, public_profile or null.
            'signup_ref' => $user->getAttribute('signup_ref'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function settings(User $user): array
    {
        $enum = fn (mixed $value): mixed => $value instanceof \BackedEnum ? $value->value : $value;

        return [
            'locale' => $user->getAttribute('locale'),
            'theme' => $enum($user->getAttribute('theme')),
            'power_display' => $enum($user->getAttribute('power_display')),
            'who_can_message' => $enum($user->getAttribute('who_can_message')),
            'discoverable' => $user->getAttribute('discoverable') !== false,
            'indexable' => $user->getAttribute('indexable') !== false,
            'show_owner_on_qr' => $user->getAttribute('show_owner_on_qr') !== false,
            'read_receipts' => $user->getAttribute('read_receipts') !== false,
            // M3.7 SET privacy "KI-Vorschläge".
            'ai_suggestions' => $user->getAttribute('ai_suggestions') === true,
            'notification_prefs' => NotificationPrefs::for($user),
            'two_factor_enabled' => $user->hasTwoFactor(),
            'two_factor_enabled_at' => $this->date($user->getAttribute('two_factor_confirmed_at')),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function consents(User $user): array
    {
        return [
            'terms_version' => $user->getAttribute('terms_version'),
            'privacy_version' => $user->getAttribute('privacy_version'),
            'consented_at' => $this->date($user->getAttribute('consented_at')),
            'age_16_confirmed' => $user->getAttribute('consented_at') !== null,
            'marketing_consent_at' => $this->date($user->getAttribute('marketing_consent_at')),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function vehicles(User $user): array
    {
        $vehicles = Vehicle::withTrashed()
            ->where('owner_id', $user->getKey())
            ->with(['make', 'vehicleModel', 'generation', 'specs', 'qrCodes'])
            ->orderBy('sort')
            ->orderBy('id')
            ->get();

        $rows = [];

        foreach ($vehicles as $vehicle) {
            $mods = DB::table('modifications')
                ->leftJoin('mod_categories', 'mod_categories.id', '=', 'modifications.category_id')
                ->leftJoin('brands', 'brands.id', '=', 'modifications.brand_id')
                ->where('modifications.vehicle_id', $vehicle->id)
                ->orderBy('modifications.sort')
                ->orderBy('modifications.id')
                ->get([
                    'modifications.id', 'mod_categories.key as category', 'modifications.title', 'brands.name as brand', 'modifications.brand_text',
                    'modifications.part_name', 'modifications.part_number', 'modifications.status', 'modifications.installed_on',
                    'modifications.cost_cents', 'modifications.cost_public', 'modifications.legal_status', 'modifications.notes',
                    'modifications.fields', 'modifications.created_at', 'modifications.updated_at', 'modifications.deleted_at',
                ])
                ->map(fn (object $mod): array => [...(array) $mod, 'fields' => is_string($mod->fields) ? json_decode($mod->fields, true) : null])
                ->all();

            $updates = DB::table('build_updates')
                ->where('vehicle_id', $vehicle->id)
                ->orderBy('created_at')
                ->orderBy('id')
                ->get(['id', 'type', 'payload', 'note', 'hidden', 'created_at'])
                ->map(fn (object $update): array => [...(array) $update, 'payload' => is_string($update->payload) ? json_decode($update->payload, true) : null, 'hidden' => (bool) $update->hidden])
                ->all();

            $specs = $vehicle->specs?->attributesToArray();
            unset($specs['vehicle_id']);

            $rows[] = [
                'id' => $vehicle->id,
                'public_id' => $vehicle->getAttribute('public_id'),
                'slug' => $vehicle->getAttribute('slug'),
                'status' => $this->value($vehicle->getAttribute('status')),
                'visibility' => $this->value($vehicle->getAttribute('visibility')),
                'is_main' => (bool) $vehicle->getAttribute('is_main'),
                'make' => $vehicle->make?->getAttribute('name') ?? $vehicle->getAttribute('make_text'),
                'model' => $vehicle->vehicleModel?->getAttribute('name') ?? $vehicle->getAttribute('model_text'),
                'generation' => $vehicle->generation?->getAttribute('name'),
                'model_year' => $vehicle->getAttribute('model_year'),
                'nickname' => $vehicle->getAttribute('nickname'),
                'description' => $vehicle->getAttribute('description'),
                'color' => $vehicle->getAttribute('color'),
                'hu_au_due' => $this->date($vehicle->getAttribute('hu_au_due')),
                'cover' => $this->photoRef($vehicle->getAttribute('cover_media_id')),
                'specs' => $specs,
                'modifications' => $mods,
                'build_updates' => $updates,
                'qr_codes' => $vehicle->qrCodes->map(fn ($qr): array => [
                    'code' => $qr->getAttribute('code'),
                    'status' => $this->value($qr->getAttribute('status')),
                    'revoked_at' => $this->date($qr->getAttribute('revoked_at')),
                    'revoked_reason' => $this->value($qr->getAttribute('revoked_reason')),
                    'created_at' => $this->date($qr->getAttribute('created_at')),
                ])->all(),
                'published_at' => $this->date($vehicle->getAttribute('published_at')),
                'archived_at' => $this->date($vehicle->getAttribute('archived_at')),
                'created_at' => $this->date($vehicle->created_at),
                'updated_at' => $this->date($vehicle->updated_at),
                'deleted_at' => $this->date($vehicle->getAttribute('deleted_at')),
            ];
        }

        return $rows;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function photos(User $user, bool $forStaff): array
    {
        return $this->photoQuery($user, $forStaff)
            ->get(['id', 'original_path', 'mediable_type', 'mediable_id', 'width', 'height', 'alt', 'category', 'sort', 'status', 'created_at', 'deleted_at'])
            ->map(fn (object $photo): array => [
                'file' => self::photoFile((string) $photo->id, is_string($photo->original_path) ? $photo->original_path : null),
                'id' => $photo->id,
                'attached_to' => $photo->mediable_type === null ? null : ['type' => $photo->mediable_type, 'id' => $photo->mediable_id],
                'width' => $photo->width,
                'height' => $photo->height,
                'alt' => $photo->alt,
                'category' => $photo->category,
                'sort' => $photo->sort,
                'status' => $photo->status,
                'created_at' => $photo->created_at,
                'deleted_at' => $photo->deleted_at,
            ])
            ->all();
    }

    /**
     * Usernames only (contract §3): a follower's profile is theirs, not part of this member's data.
     *
     * @return array{following: array<int, array{username: mixed, since: mixed}>, followers: array<int, array{username: mixed, since: mixed}>}
     */
    private function follows(User $user): array
    {
        $list = fn (string $mine, string $theirs): array => DB::table('follows')
            ->leftJoin('users', 'users.id', '=', 'follows.'.$theirs)
            ->where('follows.'.$mine, $user->getKey())
            ->orderBy('follows.created_at')
            ->get(['users.username', 'follows.created_at'])
            ->map(fn (object $row): array => ['username' => $row->username, 'since' => $row->created_at])
            ->all();

        return ['following' => $list('follower_id', 'followee_id'), 'followers' => $list('followee_id', 'follower_id')];
    }

    /**
     * @return array<int, array{username: mixed, blocked_at: mixed}>
     */
    private function blocks(User $user): array
    {
        return DB::table('blocks')
            ->where('blocker_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['blocked_username', 'created_at'])
            ->map(fn (object $row): array => ['username' => $row->blocked_username, 'blocked_at' => $row->created_at])
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function saves(User $user): array
    {
        return DB::table('saves')
            ->join('vehicles', 'vehicles.id', '=', 'saves.vehicle_id')
            ->leftJoin('users', 'users.id', '=', 'vehicles.owner_id')
            ->where('saves.user_id', $user->getKey())
            ->orderBy('saves.created_at')
            ->get(['vehicles.public_id', 'vehicles.slug', 'users.username as owner', 'saves.created_at'])
            ->map(fn (object $row): array => ['vehicle' => '/v/'.$row->slug.'-'.$row->public_id, 'owner' => $row->owner, 'saved_at' => $row->created_at])
            ->all();
    }

    /**
     * What the member can see in MSG-01/MSG-02: conversations not deleted for them, messages after their own "delete for me" point
     * and not hidden for them. The other side by username; a hard-deleted member is null ("Gelöschtes Mitglied" in the app).
     *
     * @return array<int, array<string, mixed>> a page of at most $limit conversations after $after, by id (keyset)
     */
    public function conversationsAfter(User $user, ?string $after, int $limit): array
    {
        if (! Schema::hasTable('conversation_participants')) {
            return [];
        }

        $mine = DB::table('conversation_participants')
            ->where('user_id', $user->getKey())
            ->whereNull('deleted_at')
            ->when($after !== null, fn ($query) => $query->where('conversation_id', '>', $after))
            ->orderBy('conversation_id')
            ->limit($limit)
            ->get(['conversation_id', 'folder', 'accepted_at', 'cleared_before_message_id', 'created_at']);

        $rows = [];

        foreach ($mine as $participant) {
            $others = DB::table('conversation_participants')
                ->leftJoin('users', 'users.id', '=', 'conversation_participants.user_id')
                ->where('conversation_participants.conversation_id', $participant->conversation_id)
                ->where('conversation_participants.user_id', '!=', $user->getKey())
                ->pluck('users.username')
                ->all();

            $messages = DB::table('messages')
                ->leftJoin('users', 'users.id', '=', 'messages.sender_id')
                ->where('messages.conversation_id', $participant->conversation_id)
                ->whereNull('messages.deleted_at')
                ->when(is_string($participant->cleared_before_message_id), fn ($query) => $query->where('messages.id', '>', $participant->cleared_before_message_id))
                ->whereNotExists(fn ($hidden) => $hidden->from('message_hidden')->whereColumn('message_hidden.message_id', 'messages.id')->where('message_hidden.user_id', $user->getKey()))
                ->orderBy('messages.id')
                ->get(['messages.id', 'messages.sender_id', 'users.username', 'messages.type', 'messages.body', 'messages.media_id', 'messages.created_at'])
                ->map(fn (object $message): array => [
                    'id' => $message->id,
                    'from' => $message->sender_id === $user->getKey() ? 'me' : $message->username,
                    'type' => $message->type,
                    'body' => $message->body,
                    'photo' => $message->media_id === null ? null : ($message->sender_id === $user->getKey() ? self::photoFile((string) $message->media_id, null) : 'not included: sent by the other member'),
                    'sent_at' => $message->created_at,
                ])
                ->all();

            $rows[] = [
                'id' => $participant->conversation_id,
                'with' => $others,
                'folder' => $participant->folder,
                'accepted_at' => $participant->accepted_at,
                'messages' => $messages,
            ];
        }

        return $rows;
    }

    /**
     * The staff copy of conversationsAfter() (SEC-P3-01): the same conversations, without a single message: partner, folder, dates and
     * counts only.
     *
     * @return array<int, array<string, mixed>>
     */
    public function conversationMetadataAfter(User $user, ?string $after, int $limit): array
    {
        if (! Schema::hasTable('conversation_participants')) {
            return [];
        }

        $mine = DB::table('conversation_participants')
            ->where('user_id', $user->getKey())
            ->whereNull('deleted_at')
            ->when($after !== null, fn ($query) => $query->where('conversation_id', '>', $after))
            ->orderBy('conversation_id')
            ->limit($limit)
            ->get(['conversation_id', 'folder', 'accepted_at', 'created_at']);

        $rows = [];

        foreach ($mine as $participant) {
            $messages = DB::table('messages')->where('conversation_id', $participant->conversation_id)->whereNull('deleted_at');

            $rows[] = [
                'id' => $participant->conversation_id,
                'with' => DB::table('conversation_participants')
                    ->leftJoin('users', 'users.id', '=', 'conversation_participants.user_id')
                    ->where('conversation_participants.conversation_id', $participant->conversation_id)
                    ->where('conversation_participants.user_id', '!=', $user->getKey())
                    ->pluck('users.username')
                    ->all(),
                'folder' => $participant->folder,
                'accepted_at' => $participant->accepted_at,
                'joined_at' => $participant->created_at,
                'messages' => (clone $messages)->count(),
                'messages_sent' => (clone $messages)->where('sender_id', $user->getKey())->count(),
                'first_message_at' => (clone $messages)->min('created_at'),
                'last_message_at' => (clone $messages)->max('created_at'),
            ];
        }

        return $rows;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function notificationsAfter(User $user, ?string $after, int $limit): array
    {
        return DB::table('notifications')
            ->where('notifiable_id', $user->getKey())
            ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
            ->orderBy('id')
            ->limit($limit)
            ->get(['id', 'type', 'data', 'actor_count', 'read_at', 'created_at'])
            ->map(fn (object $row): array => [
                'id' => $row->id,
                'type' => $row->type,
                'details' => is_string($row->data) ? json_decode($row->data, true) : null,
                'actor_count' => $row->actor_count,
                'read_at' => $row->read_at,
                'created_at' => $row->created_at,
            ])
            ->all();
    }

    /**
     * Reports this member filed (M2.6). Read defensively: the table belongs to the safety module.
     *
     * @return array<int, array<string, mixed>>
     */
    private function reports(User $user): array
    {
        if (! Schema::hasTable('reports') || ! Schema::hasColumn('reports', 'reporter_id')) {
            return [];
        }

        $columns = array_values(array_filter(
            ['target_type', 'target_id', 'reason', 'sub_reason', 'details', 'created_at'],
            fn (string $column): bool => Schema::hasColumn('reports', $column),
        ));

        return DB::table('reports')
            ->where('reporter_id', $user->getKey())
            ->orderBy('created_at')
            ->get($columns)
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * Decisions that restricted this member (M2.6, Art. 17 DSA): what, when, the restriction and the full statement of reasons. Nothing
     * about the reports behind them or who filed them.
     *
     * @return list<array<string, mixed>>
     */
    private function moderationDecisions(User $user): array
    {
        return array_values(DB::table('decisions')
            ->join('moderation_cases', 'moderation_cases.id', '=', 'decisions.case_id')
            ->where('decisions.subject_id', $user->getKey())
            ->where('decisions.action', '!=', DecisionAction::NoAction->value)
            ->orderBy('decisions.decided_at')
            ->get(['decisions.id', 'moderation_cases.target_type', 'decisions.action', 'decisions.restriction', 'decisions.statement_of_reasons', 'decisions.decided_at', 'decisions.notified_at'])
            ->map(fn (object $row): array => [
                'id' => $row->id,
                'target_type' => $row->target_type,
                'action' => $row->action,
                'restriction' => is_string($row->restriction) ? json_decode($row->restriction, true) : null,
                'statement_of_reasons' => is_string($row->statement_of_reasons) ? json_decode($row->statement_of_reasons, true) : null,
                'decided_at' => $row->decided_at,
                'notified_at' => $row->notified_at,
            ])
            ->all());
    }

    /**
     * Appeals this member filed, with their own text.
     *
     * @return list<array<string, mixed>>
     */
    private function appeals(User $user): array
    {
        return array_values(DB::table('appeals')
            ->where('appellant_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['decision_id', 'role', 'text', 'status', 'created_at', 'decided_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all());
    }

    /**
     * The member's tickets with the thread they read in SET-15 (member, guest and team replies).
     *
     * @return array<int, array<string, mixed>>
     */
    private function supportTickets(User $user, bool $forStaff): array
    {
        $tickets = DB::table('support_tickets')->where('user_id', $user->getKey())->orderBy('created_at')->get(['id', 'category', 'subject', 'status', 'created_at', 'closed_at']);

        return $tickets->map(fn (object $ticket): array => [
            ...(array) $ticket,
            'messages' => DB::table('ticket_messages')
                ->where('ticket_id', $ticket->id)
                // SEC-P3-12: the team's internal notes never reach the member (ADR-240 f); the four-eyes staff copy keeps them.
                ->when(! $forStaff, fn ($query) => $query->where('internal', false))
                ->orderBy('created_at')
                ->get(['author_type', 'body', 'created_at'])
                ->map(fn (object $message): array => (array) $message)
                ->all(),
        ])->all();
    }

    /**
     * SET-06's list: device names and dates, no IP and no place (none is stored).
     *
     * @return array<int, array<string, mixed>>
     */
    private function devices(User $user): array
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', $user->getMorphClass())
            ->where('tokenable_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['device_name', 'name', 'platform', 'app_version', 'created_at', 'last_used_at', 'expires_at'])
            ->map(fn (object $row): array => [
                'device_name' => $row->device_name ?? $row->name,
                'platform' => $row->platform,
                'app_version' => $row->app_version,
                'signed_in_at' => $row->created_at,
                'last_used_at' => $row->last_used_at,
                'expires_at' => $row->expires_at,
            ])
            ->all();
    }

    /**
     * The member's own security log (05 §13): what happened and when, with the device name where one was recorded. Never an IP (none is
     * stored for members, ADR-113) and never the hash chain.
     *
     * @return array<int, array<string, mixed>>
     */
    private function securityEvents(User $user): array
    {
        return DB::table('audit_events')
            ->where('target_type', $user->getMorphClass())
            ->where('target_id', $user->getKey())
            ->where('action', 'like', 'member.%')
            ->orderBy('id')
            ->get(['action', 'occurred_at', 'after'])
            ->map(function (object $row): array {
                $after = is_string($row->after) ? json_decode($row->after, true) : null;
                $device = is_array($after) && is_string($after['device_name'] ?? null) ? $after['device_name'] : null;

                return ['action' => $row->action, 'at' => $row->occurred_at, 'device_name' => $device];
            })
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function reactions(User $user): array
    {
        if (! Schema::hasTable('message_reactions')) {
            return [];
        }

        return DB::table('message_reactions')
            ->where('user_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['message_id', 'reaction', 'created_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    private function reactionCount(User $user): int
    {
        return Schema::hasTable('message_reactions') ? DB::table('message_reactions')->where('user_id', $user->getKey())->count() : 0;
    }

    /**
     * Installs that get push notices. The token itself is left out: it is an address for Expo, not the member's data.
     *
     * @return array<int, array<string, mixed>>
     */
    private function pushDevices(User $user): array
    {
        return DB::table('push_tokens')
            ->where('user_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['platform', 'created_at', 'last_used_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * Browser sign-ins of SET-06, as browser and system ("Chrome auf macOS"), with the last use. No IP is stored (should-fix 9).
     *
     * @return array<int, array<string, mixed>>
     */
    private function browserSessions(User $user): array
    {
        if (! Schema::hasTable(config()->string('session.table'))) {
            return [];
        }

        return DB::table(config()->string('session.table'))
            ->where('user_id', $user->getKey())
            ->orderBy('last_activity')
            ->get(['user_agent', 'last_activity'])
            ->map(fn (object $row): array => [
                'browser' => DeviceSessions::browserName(is_string($row->user_agent) ? $row->user_agent : ''),
                'last_used_at' => date(DATE_ATOM, (int) $row->last_activity),
            ])
            ->all();
    }

    private function photoRef(mixed $mediaId): ?string
    {
        if (! is_string($mediaId)) {
            return null;
        }

        $path = Media::withTrashed()->whereKey($mediaId)->value('original_path');

        return is_string($path) ? self::photoFile($mediaId, $path) : null;
    }

    private function date(mixed $value): ?string
    {
        return $value instanceof DateTimeInterface ? $value->format(DATE_ATOM) : (is_string($value) ? $value : null);
    }

    private function value(mixed $value): mixed
    {
        return $value instanceof \BackedEnum ? $value->value : $value;
    }
}
