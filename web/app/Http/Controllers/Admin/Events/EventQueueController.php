<?php

namespace App\Http\Controllers\Admin\Events;

use App\Enums\EventStatus;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-53 Treffen-Queue (09 §10.3, SplitQueue of §10.2): tabs In Prüfung (oldest first: the SLA order) · Veröffentlicht · Abgelehnt ·
 * Abgesagt · Alle, filters q (title, city, @organiser), type and location visibility, the row props of EventAdminRecord. `?event=<id>`
 * opens that event in the right pane (`selected`, the ADM-54 record); `decided` is the last decision of this session (the 5-s undo).
 */
class EventQueueController extends Controller
{
    public const TABS = ['pending', 'published', 'rejected', 'cancelled', 'all'];

    public const TABLE = 'events';

    /** Session flash of EventActionsController: the event just decided, for the undo. */
    public const DECIDED = 'events.decided';

    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'pending';
        $status = match ($tab) {
            'pending' => EventStatus::PendingReview,
            'published' => EventStatus::Published,
            'rejected' => EventStatus::Rejected,
            'cancelled' => EventStatus::Cancelled,
            default => null,
        };
        $defaultSort = $tab === 'pending' ? 'submitted_at' : '-submitted_at';

        $base = Event::query()->with('organiser')
            ->when($status !== null, fn (Builder $query) => $query->where('events.status', $status?->value))
            ->where('events.status', '!=', EventStatus::Draft->value);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $term = is_string($value) ? trim($value) : '';

                    if ($term === '') {
                        return;
                    }

                    $like = '%'.addcslashes(ltrim($term, '@'), '%_\\').'%';
                    $q->where(fn (Builder $any) => $any->where('events.title', 'like', $like)->orWhere('events.city', 'like', $like)
                        ->orWhereHas('organiser', fn (Builder $organiser) => $organiser->where('username', 'like', $like)));
                }),
                AllowedFilter::callback('type', fn (Builder $q, mixed $value) => $q->where('events.type', is_string($value) ? $value : '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('location_visibility', fn (Builder $q, mixed $value) => $q->where('events.location_visibility', is_string($value) ? $value : '-'))->delimiter("\u{1}"),
            )
            ->allowedSorts('submitted_at', 'starts_at', 'created_at')
            ->defaultSort($defaultSort);

        return Inertia::render('Events/Queue', [
            ...TableProps::make($query, $request, self::TABLE.'-'.$tab, $staff, fn (array $events): array => EventAdminRecord::rows($events), $defaultSort),
            'tab' => $tab,
            'counts' => fn (): array => [
                'pending' => Event::query()->where('status', EventStatus::PendingReview->value)->count(),
            ],
            'canDecide' => $staff->can('moderation.decide'),
            'selected' => fn (): ?array => self::selected($request, $staff),
            'decided' => fn (): mixed => $request->session()->get(self::DECIDED),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function selected(Request $request, Staff $staff): ?array
    {
        $id = $request->query('event');

        if (! is_string($id) || preg_match('/^[0-9A-Za-z]{26}$/', $id) !== 1) {
            return null;
        }

        $event = Event::query()->with('organiser')->where('status', '!=', EventStatus::Draft->value)->find(strtolower($id));

        return $event === null ? null : EventAdminRecord::detail($event, $staff);
    }
}
