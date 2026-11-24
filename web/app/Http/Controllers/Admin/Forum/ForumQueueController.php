<?php

namespace App\Http\Controllers\Admin\Forum;

use App\Enums\CaseStatus;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Moderation\SorTemplates;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM Forum-Moderation (10 §7.3, 09 §10.2 SplitQueue, m5.8-contract §6): tabs Vormoderation (pending posts, oldest first: the SLA order)
 * · Gemeldet (open DSA cases of forum posts; decided on ADM-21) · Themen (every thread, filters q, category, status, pinned, locked) ·
 * Entfernt. `?thread=<id>` (and `item=<post id>`) opens the thread in the right pane (`selected`); `decided` is this session's last
 * pre-moderation decision (toast, undo-free: a decision is final).
 */
class ForumQueueController extends Controller
{
    public const TABS = ['pending', 'reported', 'threads', 'removed'];

    /** Session flash of ForumPostActionsController: the post just decided. */
    public const DECIDED = 'forum.decided';

    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'pending';

        $table = match ($tab) {
            'pending' => TableProps::make(
                QueryBuilder::for(self::pending()->with(['thread.category', 'user'])->withCount('photos'), $request)
                    ->allowedSorts('created_at')->defaultSort('created_at'),
                $request, 'forum-pending', $staff, fn (array $posts): array => ForumAdminRecord::pendingRows($posts), 'created_at',
            ),
            'reported' => TableProps::make(
                QueryBuilder::for(ModerationCase::query()->where('target_type', ReportTargetType::ForumPost->value)
                    ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value]), $request)
                    ->allowedSorts('created_at', 'priority')->defaultSort('-priority'),
                $request, 'forum-reported', $staff, fn (array $cases): array => ForumAdminRecord::reportedRows($cases), '-priority',
            ),
            default => TableProps::make(
                QueryBuilder::for(ForumThread::query()->with(['category', 'user'])
                    ->when($tab === 'removed', fn (Builder $query) => $query->where('status', ForumThreadStatus::Removed->value)), $request)
                    ->allowedFilters(
                        AllowedFilter::callback('q', function (Builder $query, mixed $value): void {
                            $term = is_string($value) ? trim($value) : '';

                            if ($term !== '') {
                                $like = '%'.addcslashes(ltrim($term, '@'), '%_\\').'%';
                                $query->where(fn (Builder $any) => $any->where('forum_threads.title', 'like', $like)
                                    ->orWhereHas('user', fn (Builder $user) => $user->where('username', 'like', $like)));
                            }
                        }),
                        AllowedFilter::callback('category', fn (Builder $query, mixed $value) => $query->where('category_id', is_numeric($value) ? (int) $value : 0)),
                        AllowedFilter::callback('status', fn (Builder $query, mixed $value) => $query->where('status', ForumThreadStatus::tryFrom(is_string($value) ? $value : '')->value ?? '-')),
                        AllowedFilter::callback('pinned', fn (Builder $query, mixed $value) => $query->where('is_pinned', filter_var($value, FILTER_VALIDATE_BOOLEAN))),
                        AllowedFilter::callback('locked', fn (Builder $query, mixed $value) => $query->where('is_locked', filter_var($value, FILTER_VALIDATE_BOOLEAN))),
                    )
                    ->allowedSorts('last_activity_at', 'created_at', 'replies_count')->defaultSort('-last_activity_at'),
                $request, 'forum-'.$tab, $staff, fn (array $threads): array => ForumAdminRecord::threadRows($threads), '-last_activity_at',
            ),
        };

        return Inertia::render('Forum/Queue', [
            ...$table,
            'tab' => $tab,
            'counts' => fn (): array => [
                // The same query as the tab, so the badge and the list agree (posts of deleted threads are in neither).
                'pending' => self::pending()->count(),
                'reported' => ModerationCase::query()->where('target_type', ReportTargetType::ForumPost->value)
                    ->whereIn('status', [CaseStatus::New->value, CaseStatus::InReview->value])->count(),
            ],
            'canDecide' => $staff->can('moderation.decide'),
            'canBan' => $staff->can('members.restrict'),
            'canManageCategories' => $staff->can('moderation.rules'),
            'categories' => fn (): array => ForumCategory::query()->orderBy('sort')->get(['id', 'name_de', 'parent_id'])
                ->map(fn (ForumCategory $category): array => ['id' => $category->id, 'name' => $category->name_de, 'parent_id' => $category->parent_id])->all(),
            'selected' => fn (): ?array => self::selected($request, $staff),
            'decided' => fn (): mixed => $request->session()->get(self::DECIDED),
            'templates' => fn (): array => $staff->can('moderation.decide') ? SorTemplates::all() : [],
        ]);
    }

    /**
     * Pending posts of threads that still exist.
     *
     * @return Builder<ForumPost>
     */
    private static function pending(): Builder
    {
        return ForumPost::query()->where('forum_posts.status', ForumPostStatus::Pending->value)
            ->whereHas('thread', fn (Builder $thread) => $thread->whereNull('forum_threads.deleted_at'));
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function selected(Request $request, Staff $staff): ?array
    {
        $id = $request->query('thread');
        $item = $request->query('item');
        $item = is_string($item) && preg_match('/^[0-9A-Za-z]{26}$/', $item) === 1 ? strtolower($item) : null;

        if ((! is_string($id) || preg_match('/^[0-9A-Za-z]{26}$/', $id) !== 1) && $item !== null) {
            $id = ForumPost::withTrashed()->whereKey($item)->value('thread_id');
        }

        if (! is_string($id) || preg_match('/^[0-9A-Za-z]{26}$/', $id) !== 1) {
            return null;
        }

        $thread = ForumThread::withTrashed()->with(['category', 'user', 'vehicle'])->find(strtolower($id));

        return $thread instanceof ForumThread ? ForumAdminRecord::detail($thread, $item, $staff) : null;
    }
}
