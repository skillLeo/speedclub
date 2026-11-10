<?php

namespace App\Services\Account;

use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

/**
 * ADR-123 for a closed account (SET-13): every public photo file of the member goes now, in slices of
 * speedclub.account_deletion.media_per_job, each slice queueing the next. The rows are soft-deleted, the private originals wait for the
 * hard delete. Photos sent in messages stay until then, because the other side keeps the conversation.
 *
 * Runs after the response (and again from the queue if the request died), so the member's photos stop being served within the minute.
 */
class WithdrawMemberMedia implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    public function __construct(public readonly string $userId) {}

    public function handle(MediaService $media): void
    {
        $user = User::withTrashed()->find($this->userId);

        if ($user === null || ! $user->isPendingDeletion()) {
            return;
        }

        $limit = max(1, config()->integer('speedclub.account_deletion.media_per_job'));
        $deadline = microtime(true) + max(1, config()->integer('speedclub.account_deletion.job_seconds'));

        $photos = Media::query()
            ->where('owner_id', $user->id)
            ->where(fn ($query) => $query->whereNull('mediable_type')->orWhereNotIn('mediable_type', ['message', 'conversation']))
            ->orderBy('id')
            ->limit($limit)
            ->get();

        foreach ($photos as $photo) {
            if (microtime(true) > $deadline) {
                self::dispatch($this->userId);

                return;
            }

            $photo->delete();
            $media->withdraw($photo);
        }

        DB::table('users')->where('id', $user->id)->update(['avatar_media_id' => null, 'cover_media_id' => null]);
        Vehicle::withTrashed()->where('owner_id', $user->id)->toBase()->update(['cover_media_id' => null]);

        if ($photos->count() === $limit) {
            self::dispatch($this->userId);
        }
    }
}
