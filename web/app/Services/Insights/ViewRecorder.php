<?php

namespace App\Services\Insights;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Support\ClientAddress;
use App\Support\ViewAs;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

/**
 * M5.7 view counting (10 §6.1, m5.7-contract §2). One view per person, public page and Europe/Berlin day, with the source of the first
 * one. The person is only HMAC-SHA256(day's salt, key) — the key being the member id, or for a guest the address (/64 for IPv6) and the
 * user agent — cut to 128 bits; the salt is deleted when the day ends (ViewSalts). Not counted: the owner, staff in view-as, samples (car,
 * owner or viewer), anything the viewer may not see (blocks included), machines and prefetches (HumanVisit), and everything while the
 * flag `insights` is off.
 *
 * capture() runs in the request (it needs the request to decide and to hash), store() may run after the response: it gets the hash only.
 * Neither ever throws: a lost count must never cost anybody the page.
 */
final class ViewRecorder
{
    public const FLAG = 'insights';

    /** SF-1: new guest views one address may add to one page per Berlin day (members count once each, by their id). */
    public const GUEST_VIEWS_PER_ADDRESS = 3;

    public function __construct(private readonly ViewSalts $salts) {}

    /**
     * A view of $vehicle's page by $viewer (the member behind the token or the browser's session; null for a guest), or null when it
     * does not count.
     */
    public function captureVehicle(Vehicle $vehicle, ViewSource $source, ?User $viewer, Request $request, bool $page): ?PendingView
    {
        return $this->safely(function () use ($vehicle, $source, $viewer, $request, $page): ?PendingView {
            $owner = $vehicle->owner;

            if ($owner === null || $vehicle->getAttribute('is_sample') === true || $owner->getAttribute('is_sample') === true
                || $vehicle->isOwnedBy($viewer) || ! $this->counts($viewer, $request, $page)
                || ! Gate::forUser($viewer)->allows('view', $vehicle)) {
                return null;
            }

            return $this->pending(ViewSubject::Vehicle, $vehicle->id, $owner->id, $vehicle->id, $source, $viewer, $request);
        });
    }

    /**
     * A view of $member's profile, or null when it does not count.
     */
    public function captureProfile(User $member, ViewSource $source, ?User $viewer, Request $request, bool $page): ?PendingView
    {
        return $this->safely(function () use ($member, $source, $viewer, $request, $page): ?PendingView {
            if ($member->getAttribute('is_sample') === true || $member->is($viewer) || ! $this->counts($viewer, $request, $page)
                || ! Gate::forUser($viewer)->allows('view', $member)) {
                return null;
            }

            return $this->pending(ViewSubject::Profile, $member->id, $member->id, null, $source, $viewer, $request);
        });
    }

    /**
     * The event (deduplicated by its unique key) and, when it was new, one more on the day's total of its source: one transaction.
     */
    public function store(?PendingView $view): void
    {
        if ($view === null) {
            return;
        }

        // SF-1 (review M5.6/M5.7): a guest's user agent is the guest's own choice, so one address could add a view per request by rotating
        // it. At most GUEST_VIEWS_PER_ADDRESS new guest views per address, subject and Berlin day; the key is a hash with the day's salt
        // (no address stored), kept in the rate limiter's cache until the day ends.
        $capKey = $view->addressKey === null ? null : 'views:guest:'.$view->addressKey;

        if ($capKey !== null && RateLimiter::tooManyAttempts($capKey, self::GUEST_VIEWS_PER_ADDRESS)) {
            return;
        }

        try {
            DB::transaction(function () use ($view, $capKey): void {
                $inserted = DB::table('view_events')->insertOrIgnore([
                    'subject_type' => $view->subject->value,
                    'subject_id' => $view->subjectId,
                    'owner_id' => $view->ownerId,
                    'vehicle_id' => $view->vehicleId,
                    'day' => $view->day,
                    'source' => $view->source->value,
                    'viewer_hash' => $view->viewerHash,
                ]);

                if ($inserted !== 1) {
                    return;
                }

                if ($capKey !== null) {
                    RateLimiter::hit($capKey, self::secondsLeftToday());
                }

                DB::table('view_days')->upsert([[
                    'subject_type' => $view->subject->value,
                    'subject_id' => $view->subjectId,
                    'owner_id' => $view->ownerId,
                    'vehicle_id' => $view->vehicleId,
                    'day' => $view->day,
                    'source' => $view->source->value,
                    'views' => 1,
                ]], ['subject_type', 'subject_id', 'day', 'source'], ['views' => DB::raw('`views` + 1')]);
            });
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    /**
     * After the response (the page or the beacon answer goes out first); the hash is already computed, the request is not kept.
     */
    public function storeLater(?PendingView $view): void
    {
        if ($view !== null) {
            defer(fn () => $this->store($view));
        }
    }

    private function counts(?User $viewer, Request $request, bool $page): bool
    {
        return app(FeatureFlags::class)->enabled(self::FLAG)
            && ViewAs::tokenOf($request) === null
            && $viewer?->getAttribute('is_sample') !== true
            && ($page ? HumanVisit::page($request) : HumanVisit::beacon($request));
    }

    private function pending(ViewSubject $subject, string $subjectId, string $ownerId, ?string $vehicleId, ViewSource $source, ?User $viewer, Request $request): PendingView
    {
        $day = CarbonImmutable::now(config()->string('speedclub.insights.timezone'))->toDateString();
        $key = $viewer !== null
            ? 'm|'.$viewer->id
            : 'g|'.ClientAddress::key($request).'|'.(string) $request->userAgent();

        $salt = $this->salts->forDay($day);
        $addressKey = $viewer !== null ? null : substr(hash_hmac('sha256', 'a|'.ClientAddress::key($request).'|'.$subject->value.'|'.$subjectId, $salt), 0, 32);

        return new PendingView($subject, $subjectId, $ownerId, $vehicleId, $day, $source, substr(hash_hmac('sha256', $key, $salt), 0, 32), $addressKey);
    }

    private static function secondsLeftToday(): int
    {
        $now = CarbonImmutable::now(config()->string('speedclub.insights.timezone'));

        return max(60, (int) $now->diffInSeconds($now->addDay()->startOfDay(), true));
    }

    /**
     * @param  callable(): ?PendingView  $capture
     */
    private function safely(callable $capture): ?PendingView
    {
        try {
            return $capture();
        } catch (Throwable $exception) {
            report($exception);

            return null;
        }
    }
}
