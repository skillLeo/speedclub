<?php

namespace App\Services\Events;

use App\Enums\ErrorCode;
use App\Enums\EventStatus;
use App\Enums\GalleryPhotoStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventPhoto;
use App\Models\Media;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Discover\VisibleBuilds;
use App\Services\Showcase\SampleContent;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * M5.6 post-event gallery (10 §4, m5.6-contract §4), behind `events` + `events.gallery`. Uploads are accepted from the start of a
 * published, non-sample event until gallery_days after its end, from the organiser (approved at once) and from members who are going or
 * checked in (pending until the organiser approves). Readers see approved photos of uploaders they may see: active, not deleted, no block
 * either way, sample photos only while samples are shown; removed (staff) and deleted rows never.
 */
class EventGallery
{
    public const FLAG = 'events.gallery';

    public function __construct(
        private readonly FeatureFlags $flags,
        private readonly VisibleBuilds $builds,
    ) {}

    public function enabled(): bool
    {
        return $this->flags->enabled('events') && $this->flags->enabled(self::FLAG);
    }

    /**
     * The gallery opens when the meet is over (10 §4 "gallery after the event", ADR-525 "nothing live"): an approved photo names its
     * uploader, so a window that opened at the start would tell guests who is at the meet right now.
     */
    public function opensAt(Event $event): ?CarbonImmutable
    {
        return $event->effectiveEnd();
    }

    public function closesAt(Event $event): ?CarbonImmutable
    {
        return $event->effectiveEnd()?->addDays(config()->integer('speedclub.events.gallery_days'));
    }

    /**
     * Uploads accepted now: a published event that is no sample, not removed, inside the window.
     */
    public function isOpen(Event $event): bool
    {
        $opens = $this->opensAt($event);
        $closes = $this->closesAt($event);

        return $event->status === EventStatus::Published
            && $event->getAttribute('removed_at') === null
            && ! SampleContent::isSample($event)
            && $opens !== null && $closes !== null
            && now()->between($opens, $closes);
    }

    /**
     * The organiser, a going member or one who checked in.
     */
    public function isAttendee(Event $event, User $user): bool
    {
        return $event->isOrganisedBy($user)
            || $event->isGoing($user)
            || EventCheckin::query()->where('event_id', $event->id)->where('user_id', $user->id)->exists();
    }

    /**
     * `can.add_photos`: may this member upload now (window, attendance, account state)?
     */
    public function mayAdd(Event $event, ?User $user): bool
    {
        return $user !== null
            && $user->isActive()
            && $user->hasVerifiedEmail()
            && ! $user->isRestrictedFrom(RestrictionType::Publishing)
            && $this->isOpen($event)
            && $this->isAttendee($event, $user);
    }

    /**
     * @throws ApiException 403 gallery_closed (with opens_at/closes_at), 403 gallery_not_attendee
     */
    public function assertMayAdd(Event $event, User $user): void
    {
        if (! $this->isOpen($event)) {
            throw new ApiException(ErrorCode::GalleryClosed, data: ['meta' => [
                'opens_at' => $this->opensAt($event)?->toIso8601String(),
                'closes_at' => $this->closesAt($event)?->toIso8601String(),
            ]]);
        }

        if (! $this->isAttendee($event, $user)) {
            throw new ApiException(ErrorCode::GalleryNotAttendee);
        }
    }

    /**
     * Photos of $event that $viewer may be shown at all: not deleted, not removed, the uploader active and not across a block, samples
     * only while shown. Callers narrow by status.
     *
     * @return Builder<EventPhoto>
     */
    public function photos(Event $event, ?User $viewer): Builder
    {
        $query = EventPhoto::query()
            ->where('event_photos.event_id', $event->id)
            ->where('event_photos.status', '!=', GalleryPhotoStatus::Removed->value)
            ->whereExists(fn (QueryBuilder $uploader) => $uploader->selectRaw('1')->from('users', 'gu')
                ->whereColumn('gu.id', 'event_photos.uploader_id')
                ->whereNull('gu.deleted_at')
                ->where('gu.status', UserStatus::Active->value));

        if (! $this->builds->samplesVisible()) {
            $query->where('event_photos.is_sample', false);
        }

        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'event_photos.uploader_id');

        return $query;
    }

    /**
     * What everybody may see: approved, with a finished picture staff did not reject.
     *
     * @return Builder<EventPhoto>
     */
    public function approved(Event $event, ?User $viewer): Builder
    {
        return $this->photos($event, $viewer)
            ->where('event_photos.status', GalleryPhotoStatus::Approved->value)
            ->whereExists(fn (QueryBuilder $media) => $media->selectRaw('1')->from('media', 'gm')
                ->whereColumn('gm.id', 'event_photos.media_id')
                ->whereNull('gm.deleted_at')
                ->where('gm.status', MediaStatus::Ready->value)
                ->where('gm.moderation_status', '!=', ModerationStatus::Rejected->value));
    }

    /**
     * The detail's `gallery` (m5.6-contract §4.2).
     *
     * @return array{open: bool, opens_at: string|null, closes_at: string|null, count: int, pending: int|null, mine_pending: int|null, preview: Collection<int, EventPhoto>}
     */
    public function info(Event $event, ?User $viewer): array
    {
        $organiser = $event->isOrganisedBy($viewer);
        $preview = $this->approved($event, $viewer)
            ->with(['media', 'uploader.avatar', 'event'])
            ->orderByDesc('event_photos.sort')->orderByDesc('event_photos.id')
            ->limit(config()->integer('speedclub.events.gallery_preview'))
            ->get();

        return [
            'open' => $this->isOpen($event),
            'opens_at' => $this->opensAt($event)?->toIso8601String(),
            'closes_at' => $this->closesAt($event)?->toIso8601String(),
            'count' => $this->approved($event, $viewer)->count(),
            'pending' => $organiser ? $this->photos($event, $viewer)->where('event_photos.status', GalleryPhotoStatus::Pending->value)->count() : null,
            'mine_pending' => $viewer === null ? null : EventPhoto::query()->where('event_id', $event->id)->where('uploader_id', $viewer->id)
                ->where('status', GalleryPhotoStatus::Pending->value)->count(),
            'preview' => $preview,
        ];
    }

    /**
     * How many photos count against a limit: every row that is not deleted or removed by staff (rejected ones count until the uploader
     * deletes them, so turning photos down does not open the door to more).
     *
     * $withDeleted (SEC-P5-12, an attendee's own limit): the uploader's deleted photos count too, so deleting one and uploading again
     * does not refill the limit without end. The organiser's own limit and the event's limit count what is there.
     */
    public function counted(Event $event, ?User $uploader = null, bool $withDeleted = false): int
    {
        return ($withDeleted ? EventPhoto::withTrashed() : EventPhoto::query())->where('event_id', $event->id)
            ->when($uploader !== null, fn (Builder $q) => $q->where('uploader_id', $uploader?->id))
            ->whereIn('status', [GalleryPhotoStatus::Pending->value, GalleryPhotoStatus::Approved->value, GalleryPhotoStatus::Rejected->value])
            ->count();
    }

    /**
     * Every picture of the event's gallery, for deleting the event with its files.
     *
     * @return Collection<int, Media>
     */
    public static function mediaOf(Event $event): Collection
    {
        return Media::withTrashed()->whereIn('id', EventPhoto::withTrashed()->where('event_id', $event->id)->select('media_id'))->get();
    }
}
