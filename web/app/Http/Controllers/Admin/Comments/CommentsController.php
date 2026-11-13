<?php

namespace App\Http\Controllers\Admin\Comments;

use App\Enums\CaseStatus;
use App\Enums\CommentStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Comment;
use App\Models\FeatureFlag;
use App\Models\ModerationCase;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilderBase;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-60 Kommentare (09 §8.5, §10.3; M4.17): every comment under build updates, newest first, with where it stands (reply or not, the
 * build), its author, its open report case and its status. Filters q (text or @author), status (sichtbar, entfernt, gelöscht) and
 * reported (an open case). Read-only: a comment is taken down through its DSA case on ADM-21 (statement of reasons, notices, appeal), so
 * a row links its open case. The `build_comments` flag is off at launch (09 §3.2); the page says whether members can comment now.
 * moderation.view; the text is shown as written (it is public content where the flag is on).
 */
class CommentsController extends Controller
{
    public const TABLE = 'comments';

    private const EXCERPT = 280;

    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $openCase = fn (QueryBuilderBase $cases) => $cases->select('target_id')->from('moderation_cases')->where('target_type', ReportTargetType::Comment->value)
            ->whereIn('status', array_map(fn (CaseStatus $status): string => $status->value, array_filter(CaseStatus::cases(), fn (CaseStatus $status): bool => $status->isOpen())));

        $base = Comment::query()->withTrashed()->with(['user:id,username']);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $term = is_string($value) ? trim($value) : '';

                    if ($term === '') {
                        return;
                    }

                    $like = '%'.addcslashes(ltrim($term, '@'), '%_\\').'%';
                    $q->where(fn (Builder $any) => $any->where('comments.body', 'like', $like)->orWhereHas('user', fn (Builder $user) => $user->where('username', 'like', $like)));
                }),
                AllowedFilter::callback('status', function (Builder $q, mixed $value): void {
                    match ($value) {
                        'deleted' => $q->whereNotNull('comments.deleted_at'),
                        'removed' => $q->whereNull('comments.deleted_at')->where('comments.status', CommentStatus::Removed->value),
                        default => $q->whereNull('comments.deleted_at')->where('comments.status', CommentStatus::Visible->value),
                    };
                })->delimiter("\u{1}"),
                AllowedFilter::callback('reported', fn (Builder $q) => $q->whereIn('comments.id', $openCase))->delimiter("\u{1}"),
            )
            ->allowedSorts('created_at')
            ->defaultSort('-created_at');

        return Inertia::render('Comments/Index', [
            ...TableProps::make($query, $request, self::TABLE, $staff, fn (array $comments): array => self::rows($comments), '-created_at'),
            'flag' => fn (): array => [
                'enabled' => (bool) FeatureFlag::query()->where('key', 'build_comments')->value('enabled'),
                'canManage' => $staff->can('flags.manage'),
            ],
        ]);
    }

    /**
     * @param  list<Comment>  $comments
     * @return list<array<string, mixed>>
     */
    private static function rows(array $comments): array
    {
        $ids = array_map(fn (Comment $comment): string => $comment->id, $comments);
        $cases = ModerationCase::query()->where('target_type', ReportTargetType::Comment->value)->whereIn('target_id', $ids)
            ->whereIn('status', array_map(fn (CaseStatus $status): string => $status->value, array_filter(CaseStatus::cases(), fn (CaseStatus $status): bool => $status->isOpen())))
            ->orderBy('created_at')->get(['id', 'target_id'])->groupBy('target_id');
        $vehicles = Comment::query()->withTrashed()->whereIn('comments.id', $ids)
            ->join('build_updates', 'build_updates.id', '=', 'comments.build_update_id')
            ->pluck('build_updates.vehicle_id', 'comments.id');

        return array_map(fn (Comment $comment): array => [
            'id' => $comment->id,
            'body' => Str::limit($comment->body, self::EXCERPT),
            'author' => ['id' => $comment->user_id, 'username' => $comment->user?->username],
            'reply' => $comment->parent_id !== null,
            'vehicle_id' => $vehicles[$comment->id] ?? null,
            'status' => $comment->trashed() ? 'deleted' : $comment->status->value,
            'case_id' => $cases->get($comment->id)?->first()?->id,
            'open_cases' => $cases->get($comment->id)?->count() ?? 0,
            'created_at' => $comment->created_at?->toIso8601String(),
        ], $comments);
    }
}
