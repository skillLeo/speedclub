<?php

namespace App\Http\Controllers\Admin\Forum;

use App\Actions\Admin\Forum\ReviewForumPost;
use App\Enums\CaseStatus;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use App\Services\Forum\ForumMarkdown;
use App\Services\Forum\ForumPremoderation;
use Carbon\CarbonInterface;

/**
 * The props of ADM Forum-Moderation (m5.8-contract §6): queue rows, thread rows, the selected thread with its posts, and the category
 * tree. Staff read the source text and its sanitised HTML (ForumMarkdown); never e-mail addresses.
 */
final class ForumAdminRecord
{
    /**
     * @param  list<ForumPost>  $posts
     * @return list<array<string, mixed>>
     */
    public static function pendingRows(array $posts): array
    {
        $premoderation = app(ForumPremoderation::class);
        $markdown = app(ForumMarkdown::class);

        return array_map(function (ForumPost $post) use ($premoderation, $markdown): array {
            $thread = $post->thread;
            $author = $post->user;

            return [
                'id' => $post->id,
                'kind' => $post->is_opening ? 'thread' : 'reply',
                'thread' => ['id' => $thread->id, 'title' => $thread->title, 'category' => self::categoryRef($thread->category)],
                'author' => $author instanceof User ? [
                    'id' => $author->id,
                    'username' => $author->username,
                    'joined_at' => self::iso($author->getAttribute('created_at')),
                    'email_verified' => $author->hasVerifiedEmail(),
                    'reason' => $premoderation->reason($author),
                ] : null,
                'excerpt' => $markdown->plain($post->body, 200),
                'photos_count' => $post->is_opening ? (int) ($post->getAttribute('photos_count') ?? 0) : 0,
                'created_at' => self::iso($post->created_at),
                'version' => ReviewForumPost::version($post),
            ];
        }, $posts);
    }

    /**
     * @param  list<ForumThread>  $threads
     * @return list<array<string, mixed>>
     */
    public static function threadRows(array $threads): array
    {
        return array_map(fn (ForumThread $thread): array => [
            'id' => $thread->id,
            'title' => $thread->title,
            'status' => $thread->status->value,
            'category' => self::categoryRef($thread->category),
            'author' => $thread->user instanceof User ? ['id' => $thread->user->id, 'username' => $thread->user->username] : null,
            'replies_count' => $thread->replies_count,
            'is_pinned' => $thread->is_pinned,
            'is_locked' => $thread->is_locked,
            'is_solved' => $thread->solved_post_id !== null,
            'is_sample' => $thread->is_sample,
            'last_activity_at' => self::iso($thread->last_activity_at),
            'updated_at' => self::iso($thread->updated_at),
            'version' => $thread->updated_at?->toIso8601String(),
        ], $threads);
    }

    /**
     * @param  list<ModerationCase>  $cases
     * @return list<array<string, mixed>>
     */
    public static function reportedRows(array $cases): array
    {
        $posts = ForumPost::withTrashed()->with('thread')->whereKey(array_map(fn (ModerationCase $case): string => $case->target_id, $cases))->get()->keyBy('id');

        return array_map(function (ModerationCase $case) use ($posts): array {
            $post = $posts->get($case->target_id);

            return [
                'case_id' => $case->id,
                'post_id' => $case->target_id,
                'kind' => $post instanceof ForumPost && $post->is_opening ? 'thread' : 'reply',
                'thread' => $post instanceof ForumPost ? ['id' => $post->thread->id, 'title' => $post->thread->title] : null,
                'reports' => (int) $case->getAttribute('report_count'),
                'priority' => (int) $case->getAttribute('priority'),
                'status' => $case->status->value,
                'opened_at' => self::iso($case->getAttribute('created_at')),
            ];
        }, $cases);
    }

    /**
     * The right pane: the thread, its posts (opening first, then oldest first, at most 100), photos and cases.
     *
     * @return array<string, mixed>
     */
    public static function detail(ForumThread $thread, ?string $item, Staff $staff): array
    {
        $markdown = app(ForumMarkdown::class);
        $author = $thread->user;
        $posts = ForumPost::withTrashed()->with('user')->where('thread_id', $thread->id)
            ->orderByDesc('is_opening')->orderBy('created_at')->orderBy('id')->limit(100)->get();
        $opening = $posts->firstWhere('is_opening', true);
        $photos = $opening instanceof ForumPost ? $opening->photos()->get() : collect();

        return [
            'thread' => [
                'id' => $thread->id,
                'title' => $thread->title,
                'status' => $thread->status->value,
                'category' => self::categoryRef($thread->category),
                'tags' => $thread->tags ?? [],
                'is_pinned' => $thread->is_pinned,
                'is_locked' => $thread->is_locked,
                'solved_post_id' => $thread->solved_post_id,
                'merged_into_id' => $thread->merged_into_id,
                'is_sample' => $thread->is_sample,
                'version' => $thread->updated_at?->toIso8601String(),
                'vehicle' => $thread->vehicle_id === null ? null : ['id' => $thread->vehicle_id, 'title' => $thread->vehicle?->getAttribute('nickname') ?? $thread->vehicle?->slug],
                'author' => $author instanceof User ? [
                    'id' => $author->id,
                    'username' => $author->username,
                    'joined_at' => self::iso($author->getAttribute('created_at')),
                    'email_verified' => $author->hasVerifiedEmail(),
                    'forum_restricted' => $author->isRestrictedFrom(RestrictionType::Forum),
                    'forum_restricted_until' => $author->restrictedUntil(RestrictionType::Forum)?->toIso8601String(),
                ] : null,
            ],
            'posts' => $posts->map(fn (ForumPost $post): array => [
                'id' => $post->id,
                'parent_id' => $post->parent_id,
                'is_opening' => $post->is_opening,
                'status' => $post->status->value,
                'author' => $post->user instanceof User ? ['id' => $post->user->id, 'username' => $post->user->username] : null,
                'body' => $post->body,
                'body_html' => $markdown->html($post->body),
                'helpful_count' => $post->helpful_count,
                'created_at' => self::iso($post->created_at),
                'edited_at' => self::iso($post->edited_at),
                'deleted' => $post->trashed(),
                'version' => ReviewForumPost::version($post),
            ])->values()->all(),
            'photos' => $photos->map(fn (Media $photo): array => [
                'id' => $photo->id,
                'url_320' => MediaUrls::at($photo, 320),
                'url_640' => MediaUrls::at($photo, 640),
                'width' => $photo->getAttribute('width'),
                'height' => $photo->getAttribute('height'),
            ])->values()->all(),
            'cases' => ModerationCase::query()->where('target_type', ReportTargetType::ForumPost->value)->whereIn('target_id', $posts->modelKeys())
                ->orderByDesc('created_at')->limit(20)->get()
                ->map(fn (ModerationCase $case): array => [
                    'id' => $case->id,
                    'post_id' => $case->target_id,
                    'status' => $case->status->value,
                    'open' => in_array($case->status, [CaseStatus::New, CaseStatus::InReview], true),
                    'reports' => (int) $case->getAttribute('report_count'),
                    'opened_at' => self::iso($case->getAttribute('created_at')),
                ])->values()->all(),
            'item' => $item,
            'can' => [
                'decide' => $staff->can('moderation.decide'),
                'ban' => $staff->can('members.restrict'),
            ],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function categoryTree(): array
    {
        $all = ForumCategory::query()->with('make')->orderBy('sort')->orderBy('id')->get();
        $row = fn (ForumCategory $category): array => [
            'id' => $category->id,
            'slug' => $category->slug,
            'kind' => $category->kind->value,
            'name_de' => $category->name_de,
            'name_en' => $category->name_en,
            'description_de' => $category->description_de,
            'description_en' => $category->description_en,
            'icon' => $category->icon,
            'sort' => $category->sort,
            'is_active' => $category->is_active,
            'make' => $category->make === null ? null : ['id' => $category->make->id, 'name' => $category->make->name],
            'bundesland' => $category->bundesland,
            'threads_count' => $category->threads_count,
        ];

        return array_values($all->whereNull('parent_id')->map(fn (ForumCategory $parent): array => [
            ...$row($parent),
            'children' => array_values($all->where('parent_id', $parent->id)->map($row)->all()),
        ])->all());
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private static function categoryRef(?ForumCategory $category): ?array
    {
        return $category === null ? null : ['id' => $category->id, 'name' => $category->name_de];
    }

    private static function iso(mixed $value): ?string
    {
        return $value instanceof CarbonInterface ? $value->toIso8601String() : null;
    }
}
