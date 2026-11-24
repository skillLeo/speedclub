<?php

namespace App\Actions\Forum;

use App\Actions\Media\DeleteMedia;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Services\Forum\ForumCounters;
use App\Services\Social\Mentions;
use Illuminate\Support\Facades\DB;

/**
 * The author deletes their thread while nobody else replied (m5.8-contract §2): soft delete of the thread and its posts; the photos are
 * soft-deleted like every member deletion (DeleteMedia: public files withdrawn after the commit, the private original kept until
 * media:prune, so an open case keeps its evidence; review SF-4). With replies of others: 409 forum_thread_has_replies (editing stays).
 * Reports keep their snapshot.
 */
class DeleteForumThread
{
    public function __construct(
        private readonly DeleteMedia $media,
        private readonly ForumCounters $counters,
    ) {}

    public function handle(ForumThread $thread): void
    {
        $photos = DB::transaction(function () use ($thread) {
            /** @var ForumThread $locked */
            $locked = ForumThread::query()->whereKey($thread->id)->lockForUpdate()->firstOrFail();

            if (ForumPost::query()->where('thread_id', $locked->id)->where('is_opening', false)->where('user_id', '!=', (string) $locked->user_id)->exists()) {
                throw new ApiException(ErrorCode::ForumThreadHasReplies);
            }

            $posts = ForumPost::query()->where('thread_id', $locked->id)->get();
            $photos = Media::query()->where('mediable_type', (new ForumPost)->getMorphClass())->whereIn('mediable_id', $posts->modelKeys())->get();

            foreach ($photos as $photo) {
                $this->media->softDelete($photo);
            }

            foreach ($posts as $post) {
                Mentions::forget($post);
                $post->delete();
            }

            $locked->delete();
            $this->counters->category($locked->category_id);

            return $photos;
        });

        foreach ($photos as $photo) {
            $this->media->withdraw($photo);
        }
    }
}
