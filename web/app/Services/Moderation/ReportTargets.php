<?php

namespace App\Services\Moderation;

use App\Enums\ErrorCode;
use App\Enums\ReportTargetType;
use App\Exceptions\ApiException;
use App\Models\BuildUpdate;
use App\Models\ConversationParticipant;
use App\Models\Media;
use App\Models\Message;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\PublicMembers;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrResolver;
use Illuminate\Support\Facades\Gate;

/**
 * What a report is about (m2.6-contract §2). A member may report what they can see now: the same rules as everywhere else (UserPolicy,
 * VehiclePolicy, MediaPolicy, BuildUpdatePolicy, ModificationPolicy), so anything hidden from them, across a block included, is the 404
 * of an unknown id. Their own profile or content is 422 own_content, checked first, since it tells them nothing new.
 *
 * Messages are the exception to the block rule: a participant may report any message the other side sent them, also after blocking
 * that member (a block closes the conversation, M2.4), so "Blockieren & melden" works in either order and the harassment a member
 * blocked stays reportable.
 *
 * WEB-09 (no account) may report only what a guest sees on a public page: a build (/v/{slug}, /c/{code}) or a member (/u/{username}).
 */
class ReportTargets
{
    private const ULID = '/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/';

    public function __construct(
        private readonly PublicMembers $members,
        private readonly VehiclePresenter $presenter,
        private readonly QrResolver $qr,
    ) {}

    /**
     * @throws ApiException 404 not_found when the reporter may not see it, 422 own_content for their own
     */
    public function forMember(User $reporter, ReportTargetType $type, string $id): ResolvedTarget
    {
        $target = match ($type) {
            ReportTargetType::Member => $this->member($id),
            ReportTargetType::Vehicle => $this->ulid($id) ? Vehicle::query()->with('owner')->find(strtolower($id)) : null,
            ReportTargetType::Photo => $this->ulid($id) ? Media::query()->with('mediable')->find(strtolower($id)) : null,
            ReportTargetType::BuildUpdate => $this->ulid($id) ? BuildUpdate::query()->with('vehicle.owner')->find(strtolower($id)) : null,
            ReportTargetType::Modification => $this->ulid($id) ? Modification::query()->with('vehicle.owner')->find(strtolower($id)) : null,
            ReportTargetType::Message => $this->ulid($id) ? Message::query()->with('sender')->find(strtolower($id)) : null,
        };

        if ($target === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $subjectId = $this->subjectOf($target);

        if ($subjectId !== null && $subjectId === $reporter->id) {
            throw new ApiException(ErrorCode::OwnContent);
        }

        $visible = $target instanceof Message
            ? $this->participantMayReport($reporter, $target)
            : $this->isReportablePhoto($target) && Gate::forUser($reporter)->allows('view', $target);

        if (! $visible) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $this->resolved($type, $target, $subjectId);
    }

    /**
     * WEB-09: a URL of a SPEED CLUB public page, with or without the member web app's /app prefix. Null when it names no page a guest can
     * see now; the form answers that with its help text.
     */
    public function forPublicUrl(string $url): ?ResolvedTarget
    {
        $page = $this->publicPage($url);

        if ($page === null) {
            return null;
        }

        [$kind, $value] = $page;

        $target = match ($kind) {
            'v' => Vehicle::findBySlug($value),
            'u' => $this->members->find($value),
            default => $this->qr->resolveForGuestPage($value, null)->vehicle,
        };

        if ($target === null || ! Gate::forUser(null)->allows('view', $target)) {
            return null;
        }

        return $target instanceof User
            ? $this->resolved(ReportTargetType::Member, $target, $target->id)
            : $this->resolved(ReportTargetType::Vehicle, $target, $target->owner_id);
    }

    /**
     * The canonical public page of a build or member target ("https://…/v/nissan-skyline-gt-r-r34-abcd1234"), as WEB-09 names it in its
     * confirmation mail: never what the notifier typed (M2.6 review #4). Null for other targets.
     */
    public function publicUrl(ResolvedTarget $target): ?string
    {
        return match (true) {
            $target->model instanceof Vehicle => url('/v/'.$target->model->canonicalSlug()),
            $target->model instanceof User && is_string($target->model->username) => url('/u/'.$target->model->username),
            default => null,
        };
    }

    /**
     * The kind (v, u, c, C) and value of a public page address on this site, whether or not the page exists; null for anything else.
     *
     * @return array{0: string, 1: string}|null
     */
    public function publicPage(string $url): ?array
    {
        $path = $this->ownPath($url);

        if ($path === null || preg_match('~\A/(?:app/)?(v|u|c|C)/([^/?#]+)/?\z~', $path, $match) !== 1) {
            return null;
        }

        return [$match[1], rawurldecode($match[2])];
    }

    /**
     * The path of $url when it points to this site: the host of APP_URL, by http or https. Null for anything else.
     */
    private function ownPath(string $url): ?string
    {
        $url = trim($url);

        if (! preg_match('~\Ahttps?://~i', $url)) {
            $url = 'https://'.ltrim($url, '/');
        }

        $parts = parse_url($url);
        $host = parse_url(config()->string('app.url'), PHP_URL_HOST);

        if (! is_array($parts) || ! isset($parts['host']) || ! is_string($host) || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        $given = strtolower($parts['host']);
        $own = strtolower($host);

        if ($given !== $own && $given !== 'www.'.$own) {
            return null;
        }

        return $parts['path'] ?? '/';
    }

    private function member(string $username): ?User
    {
        return mb_strlen($username) > 64 ? null : $this->members->find($username);
    }

    private function ulid(string $id): bool
    {
        return preg_match(self::ULID, $id) === 1;
    }

    /**
     * Photos of builds, mods and profiles. A message photo is reported with its message, so the context comes along.
     */
    private function isReportablePhoto(User|Vehicle|Media|BuildUpdate|Modification|Message $target): bool
    {
        if (! $target instanceof Media) {
            return true;
        }

        $parent = $target->mediable;

        return $parent instanceof Vehicle || $parent instanceof Modification || $parent instanceof User;
    }

    /**
     * A participant of the conversation (also one a block or "delete for me" closed) and a message by the other side that is not withdrawn.
     */
    private function participantMayReport(User $reporter, Message $message): bool
    {
        return ! $message->trashed()
            && ConversationParticipant::query()->where('conversation_id', $message->conversation_id)->where('user_id', $reporter->id)->exists();
    }

    private function subjectOf(User|Vehicle|Media|BuildUpdate|Modification|Message $target): ?string
    {
        return match (true) {
            $target instanceof User => $target->id,
            $target instanceof Vehicle => $target->owner_id,
            $target instanceof Media => $target->owner_id,
            $target instanceof BuildUpdate => $target->vehicle->owner_id,
            $target instanceof Modification => $target->vehicle->owner_id,
            $target instanceof Message => $target->sender_id,
        };
    }

    /**
     * A target staff act on without a report (own-initiative case, M3.2): its type, member and label, as a report would have them.
     */
    public function forStaff(User|Vehicle|Media|BuildUpdate|Modification|Message $target): ResolvedTarget
    {
        $type = match (true) {
            $target instanceof User => ReportTargetType::Member,
            $target instanceof Vehicle => ReportTargetType::Vehicle,
            $target instanceof Media => ReportTargetType::Photo,
            $target instanceof BuildUpdate => ReportTargetType::BuildUpdate,
            $target instanceof Modification => ReportTargetType::Modification,
            $target instanceof Message => ReportTargetType::Message,
        };

        return $this->resolved($type, $target, $this->subjectOf($target));
    }

    private function resolved(ReportTargetType $type, User|Vehicle|Media|BuildUpdate|Modification|Message $target, ?string $subjectId): ResolvedTarget
    {
        return new ResolvedTarget($type, $target, $subjectId, $this->label($target), $this->snapshot($target));
    }

    /**
     * Language-free: the member's @name, or the build's title for the build and everything on it; the client adds "Foto von …".
     */
    private function label(User|Vehicle|Media|BuildUpdate|Modification|Message $target): string
    {
        $label = match (true) {
            $target instanceof User => '@'.$target->username,
            $target instanceof Vehicle => $this->presenter->fullTitle($target),
            $target instanceof Media => $this->photoLabel($target),
            $target instanceof BuildUpdate, $target instanceof Modification => $this->presenter->fullTitle($target->vehicle),
            $target instanceof Message => $target->sender?->username === null ? '' : '@'.$target->sender->username,
        };

        return mb_substr($label, 0, 200);
    }

    private function photoLabel(Media $media): string
    {
        $parent = $media->mediable;

        return match (true) {
            $parent instanceof Vehicle => $this->presenter->fullTitle($parent),
            $parent instanceof Modification => $this->presenter->fullTitle($parent->vehicle),
            $parent instanceof User => '@'.$parent->username,
            default => '',
        };
    }

    /**
     * The text a member wrote, as it was when reported (ADM-22 "evidence"). Messages are added by SubmitReport (MessageEvidence).
     *
     * @return array<string, mixed>
     */
    private function snapshot(User|Vehicle|Media|BuildUpdate|Modification|Message $target): array
    {
        return match (true) {
            $target instanceof User => [
                'username' => $target->username,
                'display_name' => $target->getAttribute('display_name'),
                'bio' => $target->getAttribute('bio'),
                'avatar_media_id' => $target->getAttribute('avatar_media_id'),
                'cover_media_id' => $target->getAttribute('cover_media_id'),
            ],
            $target instanceof Vehicle => [
                'title' => $this->presenter->fullTitle($target),
                'slug' => $target->slug,
                'nickname' => $target->getAttribute('nickname'),
                'description' => $target->getAttribute('description'),
            ],
            $target instanceof Media => [
                'media_id' => $target->id,
                'parent' => $target->getAttribute('mediable_type'),
                'parent_id' => $target->getAttribute('mediable_id'),
                'alt' => $target->getAttribute('alt'),
            ],
            $target instanceof BuildUpdate => [
                'vehicle_id' => $target->vehicle_id,
                'type' => $target->getAttribute('type'),
                'note' => $target->getAttribute('note'),
                'payload' => $target->getAttribute('payload'),
            ],
            $target instanceof Modification => [
                'vehicle_id' => $target->vehicle_id,
                'title' => $target->getAttribute('title'),
                'brand_text' => $target->getAttribute('brand_text'),
                'part_name' => $target->getAttribute('part_name'),
                // SEC-P3-17: never the owner-only notes (ADR-142 a); they are not what was reported.
            ],
            $target instanceof Message => ['conversation_id' => $target->conversation_id],
        };
    }
}
