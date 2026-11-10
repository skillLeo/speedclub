<?php

namespace App\Http\Controllers\Admin\Privacy;

use App\Actions\Admin\Privacy\CreatePrivacyRequest;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Http\Controllers\Admin\Privacy\Requests\CreatePrivacyRequestRequest;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Privacy\PrivacyRequests;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-45 GDPR requests (m3.6 §1, Art. 12 GDPR): type, requester, received, due (one month, ≤ 7 days emphasised, overdue in red), status,
 * assignee; filters for the open ones, the due week and the overdue; members' own SET-12/SET-13 requests as read-only completed rows. The
 * create drawer for privacy.process holders. Sorted by due date, the open ones first (DQ-636: the work queue above what is done). The
 * deadline states, the counts and the due filters use one clock, the page's (QaClock, DQ-617).
 */
class PrivacyRequestsController extends Controller
{
    public const TABLE = 'privacy-requests';

    public const DEFAULT_SORT = 'due_at';

    public function index(Request $request, PrivacyRequests $requests): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        $open = array_map(fn (PrivacyRequestStatus $status): string => $status->value, PrivacyRequestStatus::openStates());
        $now = QaClock::now($request);
        $soon = self::soonUntil($now);

        return Inertia::render('Privacy/Requests', [
            ...TableProps::make(self::query($request, $viewer), $request, self::TABLE, $viewer, fn (array $rows): array => PrivacyPresenter::rows($rows, $viewer, $now), self::DEFAULT_SORT),
            'counts' => fn (): array => [
                'open' => PrivacyRequest::query()->whereIn('status', $open)->count(),
                'due_soon' => PrivacyRequest::query()->whereIn('status', $open)->where('due_at', '>', $now)->where('due_at', '<', $soon)->count(),
                'overdue' => PrivacyRequest::query()->whereIn('status', $open)->where('due_at', '<=', $now)->count(),
            ],
            'dueSoonDays' => config()->integer('speedclub.privacy.due_soon_days'),
            'selfService' => fn (): array => self::selfService($requests),
            'assignees' => fn (): array => $viewer->can('privacy.process') ? PrivacyPresenter::assignees() : [],
        ]);
    }

    public function store(CreatePrivacyRequestRequest $request, CreatePrivacyRequest $create): RedirectResponse
    {
        $input = $request->safe()->except(['member']);
        $username = ltrim(trim($request->string('member')->value()), '@');

        if ($username !== '') {
            $member = User::query()->where('username', $username)->first(['id']);

            if (! $member instanceof User) {
                throw ValidationException::withMessages(['member' => [__('validation.exists', ['attribute' => __('validation.attributes.username')])]]);
            }

            $input['user_id'] = $member->id;
        }

        $created = $create->handle($request->staff(), $input);

        return redirect()->route('admin.privacy.requests.show', ['privacyRequest' => $created->id], 303)->with('success', 'privacy.flash.created');
    }

    /**
     * @return QueryBuilder<PrivacyRequest>
     */
    public static function query(Request $request, Staff $viewer): QueryBuilder
    {
        $open = array_map(fn (PrivacyRequestStatus $status): string => $status->value, PrivacyRequestStatus::openStates());
        $now = QaClock::now($request);
        $dueSort = AllowedSort::custom('due_at', new OpenFirstDueSort);

        $query = QueryBuilder::for(PrivacyRequest::query()->with(['member:id,username,deleted_at', 'assignee:id,name']), $request)
            ->allowedFilters(
                AllowedFilter::callback('status', fn (Builder $q, mixed $value) => $value === 'open'
                    ? $q->whereIn('status', $open)
                    : $q->where('status', PrivacyRequestStatus::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('type', fn (Builder $q, mixed $value) => $q->where('type', PrivacyRequestType::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('due', fn (Builder $q, mixed $value) => match ($value) {
                    'soon' => $q->whereIn('status', $open)->where('due_at', '<', self::soonUntil($now)),
                    'overdue' => $q->whereIn('status', $open)->where('due_at', '<=', $now),
                    default => $q,
                })->delimiter("\u{1}"),
                AllowedFilter::callback('assigned', fn (Builder $q, mixed $value) => match ($value) {
                    'me' => $q->where('assigned_to', $viewer->id),
                    'none' => $q->whereNull('assigned_to'),
                    default => $q,
                })->delimiter("\u{1}"),
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $text = trim(mb_substr(is_string($value) ? $value : '', 0, 120));
                    $reference = strtolower((string) preg_replace('/^DS-?/i', '', $text));
                    $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], ltrim($text, '@')).'%';
                    $q->where(fn (Builder $w) => $w->whereRaw("requester_name like ? escape '!'", [$like])
                        ->orWhereHas('member', fn (Builder $m) => $m->whereRaw("username like ? escape '!'", [$like]))
                        ->when(strlen($reference) === 8 && ctype_alnum($reference), fn (Builder $r) => $r->orWhere('id', 'like', '%'.$reference)));
                })->delimiter("\u{1}"),
            )
            ->allowedSorts($dueSort, 'received_at')
            ->defaultSort($dueSort);

        $query->getEloquentBuilder()->orderBy('id');

        return $query;
    }

    /**
     * The end of the "due soon" window: the start of the Berlin day after the last emphasised day, so the count, the filter and the
     * amber rows (PrivacyPresenter::due, calendar days) agree.
     */
    private static function soonUntil(CarbonImmutable $now): CarbonImmutable
    {
        return $now->setTimezone('Europe/Berlin')->startOfDay()->addDays(config()->integer('speedclub.privacy.due_soon_days') + 1)->utc();
    }

    /**
     * Members' own requests (SET-12 export, SET-13 deletion): completed self-service, read-only, the newest 20.
     *
     * @return list<array{kind: string, member: array{id: string, username: string|null}|null, requested_at: string, status: string}>
     */
    private static function selfService(PrivacyRequests $requests): array
    {
        $rows = $requests->selfService(20);
        $ids = array_values(array_filter(array_column($rows, 'member_id'), is_string(...)));
        $names = User::withTrashed()->whereIn('id', $ids)->pluck('username', 'id');

        return array_map(fn (array $row): array => [
            'kind' => $row['kind'],
            'member' => $row['member_id'] === null ? null : ['id' => $row['member_id'], 'username' => is_string($names[$row['member_id']] ?? null) ? $names[$row['member_id']] : null],
            'requested_at' => $row['requested_at'],
            'status' => $row['status'],
        ], $rows);
    }
}
