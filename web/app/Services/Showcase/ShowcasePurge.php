<?php

namespace App\Services\Showcase;

use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ConfigKey;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\QrCode;
use App\Models\Report;
use App\Models\Save;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\Auth\MemberSessions;
use App\Services\Auth\StaffCredentials;
use App\Services\Config\ConfigVersions;
use App\Services\Events\EventHousekeeping;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Team\StaffSessions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Counts and removes the showcase (`speedclub:demo --purge`): every is_sample member and build with what hangs off them (photos and
 * their files on both disks, parts, Verlauf, QR codes and scans, follows, saves, notifications, chats between sample members, their
 * reports and cases, tickets, catalogue requests), the approvals about them or by the showcase staff, the showcase's featured entry and Home collection
 * on Home, and the showcase staff account. Real members and their data are never touched: everything is selected through is_sample.
 *
 * The audit log is append-only (database triggers), so its showcase entries stay; the staff account is anonymised like ADM-40's
 * delete, because the log names it.
 */
class ShowcasePurge
{
    public function __construct(
        private readonly MediaService $media,
        private readonly OgImages $og,
        private readonly MemberSessions $memberSessions,
        private readonly StaffSessions $staffSessions,
    ) {}

    /**
     * @return array<string, int>
     */
    public function counts(): array
    {
        $users = $this->sampleUsers();
        $vehicles = $this->sampleVehicles();
        $conversations = $this->sampleConversations();

        return [
            'members' => User::withTrashed()->where('is_sample', true)->count(),
            'vehicles' => Vehicle::withTrashed()->where('is_sample', true)->count(),
            'media' => Media::withTrashed()->whereIn('owner_id', $users)->count(),
            'modifications' => Modification::withTrashed()->whereIn('vehicle_id', $vehicles)->count(),
            'build_updates' => BuildUpdate::query()->whereIn('vehicle_id', $vehicles)->count(),
            'qr_codes' => QrCode::query()->whereIn('vehicle_id', $vehicles)->count(),
            'qr_scan_days' => DB::table('qr_scan_daily')->whereIn('qr_code_id', QrCode::query()->whereIn('vehicle_id', $vehicles)->select('id'))->count(),
            'follows' => Follow::query()->whereIn('follower_id', $users)->count(),
            'saves' => Save::query()->whereIn('user_id', $users)->count(),
            'conversations' => Conversation::query()->whereIn('id', $conversations)->count(),
            'messages' => Message::withTrashed()->whereIn('conversation_id', $conversations)->count(),
            'message_reactions' => DB::table('message_reactions')->whereIn('user_id', $users)->count(),
            'notifications' => Notification::query()->whereIn('notifiable_id', $users)->count(),
            'moderation_cases' => ModerationCase::query()->whereIn('id', $this->sampleCases())->count(),
            'reports' => Report::query()->whereIn('case_id', $this->sampleCases())->count(),
            'support_tickets' => SupportTicket::query()->whereIn('user_id', $users)->count(),
            'approval_requests' => $this->sampleApprovals()->count(),
            'catalog_requests' => CatalogRequest::query()->whereIn('user_id', $users)->count(),
            'featured_on_home' => count($this->featuredSampleIds()),
            'staff' => Staff::query()->where('is_sample', true)->whereNull('anonymised_at')->count(),
            // M4.12: sample events (and every event of a sample organiser) with the answers to them or by sample members.
            'events' => $this->sampleEvents()->count(),
            'event_rsvps' => EventRsvp::query()->where(fn (Builder $query) => $query->whereIn('event_id', $this->sampleEvents()->select('id'))->orWhereIn('user_id', $users))->count(),
        ];
    }

    /**
     * @return array<string, int> notifications of sample members by type
     */
    public function notificationsByType(): array
    {
        /** @var array<string, int> */
        return Notification::query()->whereIn('notifiable_id', $this->sampleUsers())->groupBy('type')->orderBy('type')
            ->selectRaw('type, count(*) as aggregate')->pluck('aggregate', 'type')->map(fn (mixed $count): int => (int) $count)->all();
    }

    /**
     * @return array<string, int> what was there before
     */
    public function purge(): array
    {
        $counts = $this->counts();

        $this->unfeature();

        $this->sampleApprovals()->delete();
        ModerationCase::query()->whereIn('id', $this->sampleCases()->pluck('id')->all())->delete();
        Report::query()->whereIn('reporter_id', $this->sampleUsers())->delete();
        SupportTicket::query()->whereIn('user_id', $this->sampleUsers())->delete();
        CatalogRequest::query()->whereIn('user_id', $this->sampleUsers())->delete();
        Conversation::query()->whereIn('id', $this->sampleConversations()->pluck('conversation_id')->all())->delete();
        EventRsvp::query()->whereIn('user_id', $this->sampleUsers())->delete();

        foreach ($this->sampleEvents()->get() as $event) {
            app(EventHousekeeping::class)->delete($event);
        }

        foreach (User::withTrashed()->where('is_sample', true)->get() as $user) {
            $this->removeMember($user);
        }

        foreach (Vehicle::withTrashed()->where('is_sample', true)->get() as $vehicle) {
            $this->removeVehicle($vehicle);
        }

        foreach (Staff::query()->where('is_sample', true)->whereNull('anonymised_at')->get() as $staff) {
            $this->anonymiseStaff($staff);
        }

        Audit::record(Showcase::AUDIT_PURGED, after: $counts, reason: Showcase::REASON);

        return $counts;
    }

    /**
     * A build with its photos (files on both disks), OG image, QR codes (scans cascade) and everything that cascades from the row.
     */
    public function removeVehicle(Vehicle $vehicle): void
    {
        $photos = Media::withTrashed()->where(function (Builder $query) use ($vehicle): void {
            $query->where(fn (Builder $q) => $q->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id))
                ->orWhere(fn (Builder $q) => $q->where('mediable_type', (new Modification)->getMorphClass())->whereIn('mediable_id', Modification::withTrashed()->where('vehicle_id', $vehicle->id)->select('id')));
        })->get();

        foreach ($photos as $photo) {
            $this->media->purge($photo);
        }

        $this->quietly(fn () => $this->og->purge($vehicle));

        DB::transaction(function () use ($vehicle): void {
            QrCode::query()->where('vehicle_id', $vehicle->id)->delete();
            $vehicle->forceDelete();
        });
    }

    private function removeMember(User $user): void
    {
        foreach (Media::withTrashed()->where('owner_id', $user->id)->orderBy('id')->get() as $photo) {
            $this->media->purge($photo);
        }

        foreach (Vehicle::withTrashed()->where('owner_id', $user->id)->get() as $vehicle) {
            $this->removeVehicle($vehicle);
        }

        $this->quietly(fn () => $this->og->purge($user));
        $this->quietly(fn () => $this->memberSessions->revokeAll($user));

        DB::table('personal_access_tokens')->where('tokenable_type', $user->getMorphClass())->where('tokenable_id', $user->id)->delete();
        DB::table('sessions')->where('user_id', $user->id)->delete();
        $user->forceDelete();
    }

    /**
     * As ADM-40 deletes a team member: the row stays for the audit log, nothing of the account does.
     */
    private function anonymiseStaff(Staff $staff): void
    {
        DB::transaction(function () use ($staff): void {
            $staff->forceFill([
                'name' => 'Gelöschtes Teammitglied',
                'email' => 'deleted-'.$staff->getKey().'-'.Str::lower(Str::random(8)).'@staff.invalid',
                'password' => Str::password(40),
                'status' => StaffStatus::Deactivated,
                'two_factor_secret' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_confirmed_at' => null,
                'two_factor_pending_secret' => null,
                'two_factor_pending_session' => null,
                'two_factor_pending_at' => null,
                'password_proof_required' => false,
                'anonymised_at' => now(),
            ])->save();
            $staff->syncRoles([]);
            $staff->syncPermissions([]);
            StaffCredentials::rotate($staff);
        });

        $this->quietly(fn () => $this->staffSessions->deleteAll($staff));
    }

    /**
     * The showcase's builds leave Home's featured list through a new home_curation version, published by the showcase staff (or, when
     * it is gone already, an active Owner).
     */
    private function unfeature(): void
    {
        $ids = $this->featuredSampleIds();
        $live = app(ConfigVersions::class)->live(ConfigKey::HomeCuration)?->payload;
        $hasCollection = is_array($live) && is_array($live['collections'] ?? null)
            && in_array(Showcase::COLLECTION_KEY, array_column(array_filter($live['collections'], 'is_array'), 'key'), true);

        if ($ids === [] && ! $hasCollection) {
            return;
        }

        $staff = Staff::query()->where('is_sample', true)->whereNull('anonymised_at')->where('status', StaffStatus::Active)->first()
            ?? Staff::query()->where('status', StaffStatus::Active)->get()->first(fn (Staff $candidate): bool => $candidate->isOwner());

        if (! $staff instanceof Staff) {
            return;
        }

        $versions = app(ConfigVersions::class);
        $payload = $versions->startingPayload(ConfigKey::HomeCuration);
        $payload['featured'] = array_values(array_filter(is_array($payload['featured'] ?? null) ? $payload['featured'] : [], fn (mixed $entry): bool => ! is_array($entry) || ! in_array($entry['vehicle_id'] ?? null, $ids, true)));
        $payload['collections'] = array_values(array_filter(is_array($payload['collections'] ?? null) ? $payload['collections'] : [], fn (mixed $collection): bool => ! is_array($collection) || ($collection['key'] ?? null) !== Showcase::COLLECTION_KEY));

        $draft = app(SaveConfigDraft::class)->handle($staff, ConfigKey::HomeCuration, $payload, $versions->draft(ConfigKey::HomeCuration)?->revision);
        app(PublishConfigVersion::class)->handle($staff, ConfigKey::HomeCuration, 'Showcase entfernt ('.Showcase::REASON.')', (int) $draft->revision);
    }

    /**
     * @return list<string> ids of sample builds in the live home_curation featured list
     */
    private function featuredSampleIds(): array
    {
        $payload = app(ConfigVersions::class)->live(ConfigKey::HomeCuration)?->payload;
        $ids = [];

        foreach (is_array($payload) && is_array($payload['featured'] ?? null) ? $payload['featured'] : [] as $entry) {
            if (is_array($entry) && is_string($entry['vehicle_id'] ?? null)) {
                $ids[] = $entry['vehicle_id'];
            }
        }

        return $ids === [] ? [] : array_values(Vehicle::withTrashed()->whereKey($ids)->where('is_sample', true)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all());
    }

    /**
     * @return Builder<Event>
     */
    private function sampleEvents(): Builder
    {
        return Event::query()->where(fn (Builder $query) => $query->where('is_sample', true)->orWhereIn('organiser_id', $this->sampleUsers()));
    }

    private function sampleUsers(): QueryBuilder
    {
        return DB::table('users')->where('is_sample', true)->select('id');
    }

    private function sampleVehicles(): QueryBuilder
    {
        return DB::table('vehicles')->where('is_sample', true)->select('id');
    }

    /**
     * Conversations whose every side is a sample member.
     */
    private function sampleConversations(): QueryBuilder
    {
        return DB::table('conversation_participants')
            ->whereIn('user_id', $this->sampleUsers())
            ->whereNotIn('conversation_id', ConversationParticipant::query()->whereNotIn('user_id', $this->sampleUsers())->select('conversation_id'))
            ->select('conversation_id');
    }

    /**
     * Cases about sample members or reported by them.
     */
    private function sampleCases(): QueryBuilder
    {
        return DB::table('moderation_cases')
            ->where(fn (QueryBuilder $query) => $query->whereIn('subject_id', $this->sampleUsers())
                ->orWhereIn('id', DB::table('reports')->whereIn('reporter_id', $this->sampleUsers())->select('case_id')))
            ->select('id');
    }

    /**
     * @return Builder<ApprovalRequest>
     */
    private function sampleApprovals(): Builder
    {
        return ApprovalRequest::query()->where(fn (Builder $query) => $query
            ->whereIn('requested_by', Staff::query()->where('is_sample', true)->select('id'))
            ->orWhere(fn (Builder $q) => $q->where('subject_type', (new User)->getMorphClass())->whereIn('subject_id', $this->sampleUsers()))
            ->orWhere(fn (Builder $q) => $q->where('subject_type', (new Vehicle)->getMorphClass())->whereIn('subject_id', $this->sampleVehicles())));
    }

    /**
     * @param  \Closure(): mixed  $work
     */
    private function quietly(\Closure $work): void
    {
        try {
            $work();
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
