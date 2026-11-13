<?php

namespace App\Http\Controllers\Admin\Palette;

use App\Enums\BusinessStatus;
use App\Enums\EventStatus;
use App\Http\Controllers\Admin\Search\SearchQuery;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Event;
use App\Models\FeatureFlag;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The second step of a ⌘K action (09 §10.2, M4.17): the records an action can be run on, as JSON for the palette. Reading only; the
 * action itself runs on the record's page with its own checks (password, reason, four-eyes):
 *
 * - `event` "Treffen freigeben…": meets waiting in review, oldest first → ADM-53 with the meet in the pane (moderation.decide);
 * - `business` "Betrieb verifizieren…": open applications, oldest first → ADM-55 with the pane (moderation.decide);
 * - `flag` "Flag umschalten…": feature flags by key → ADM-36 with the flag's drawer open (flags.manage).
 *
 * "Mitglied sperren…" finds members through the ADM-07 suggestions (members.view, e-mail only with members.view_pii). A kind whose atom
 * the staff member lacks answers 403. `q` filters by title, name or key (at most 120 characters); at most 8 hits.
 */
class PaletteTargetsController extends Controller
{
    private const LIMIT = 8;

    private const ATOMS = ['event' => 'moderation.decide', 'business' => 'moderation.decide', 'flag' => 'flags.manage'];

    public function __invoke(Request $request, string $kind): JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        abort_unless(isset(self::ATOMS[$kind]), 404);
        abort_unless($staff->can(self::ATOMS[$kind]), 403);

        $q = SearchQuery::from($request);
        $like = '%'.addcslashes($q, '%_\\').'%';

        $items = match ($kind) {
            'event' => Event::query()->with('organiser:id,username')->where('status', EventStatus::PendingReview->value)
                ->when($q !== '', fn (Builder $query) => $query->where('title', 'like', $like))
                ->orderBy('submitted_at')->limit(self::LIMIT)->get()
                ->map(fn (Event $event): array => [
                    'id' => $event->id,
                    'title' => $event->title,
                    'subtitle' => trim(implode(' · ', array_filter([$event->city, $event->organiser->username === null ? null : '@'.$event->organiser->username]))),
                    'url' => route('admin.events.queue', ['event' => $event->id], false),
                ])->all(),
            'business' => Business::query()->with('owner:id,username')->where('status', BusinessStatus::Applied->value)
                ->when($q !== '', fn (Builder $query) => $query->where(fn (Builder $any) => $any->where('name', 'like', $like)->orWhere('legal_name', 'like', $like)))
                ->orderBy('submitted_at')->limit(self::LIMIT)->get()
                ->map(fn (Business $business): array => [
                    'id' => $business->id,
                    'title' => $business->name,
                    'subtitle' => trim(implode(' · ', array_filter([$business->city, $business->owner->username === null ? null : '@'.$business->owner->username]))),
                    'url' => route('admin.businesses.queue', ['business' => $business->id], false),
                ])->all(),
            default => FeatureFlag::query()->when($q !== '', fn (Builder $query) => $query->where('key', 'like', $like))->orderBy('key')->limit(self::LIMIT)->get()
                ->map(fn (FeatureFlag $flag): array => [
                    'id' => (string) $flag->getKey(),
                    'title' => (string) $flag->getAttribute('key'),
                    'subtitle' => $flag->getAttribute('description') === null ? null : (string) $flag->getAttribute('description'),
                    'url' => route('admin.config.flags', ['flag' => (string) $flag->getAttribute('key')], false),
                ])->all(),
        };

        return new JsonResponse(['kind' => $kind, 'items' => array_values($items)], 200, ['Cache-Control' => 'no-store, private']);
    }
}
