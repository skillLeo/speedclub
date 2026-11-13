<?php

namespace App\Actions\Social\Updates;

use App\Actions\Media\DeleteMedia;
use App\Enums\CollectionItemType;
use App\Enums\HighlightItemType;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\Reaction;
use App\Models\VehicleHighlight;
use App\Services\Social\Collections;
use App\Services\Social\Mentions;
use Illuminate\Support\Facades\DB;

/**
 * Deletes an own note or post (09 §8.5), with everything that hangs on it: photos (files withdrawn at once), reactions, mentions, comments
 * (by the foreign key), highlights and collection entries. A report filed before keeps its snapshot (ReportTargets), so the case stays
 * reviewable.
 */
class DeleteBuildUpdate
{
    public function __construct(private readonly DeleteMedia $media) {}

    public function handle(BuildUpdate $update): void
    {
        $photos = $update->photos()->get();

        DB::transaction(function () use ($update, $photos): void {
            $id = (string) $update->getKey();
            $commentIds = Comment::withTrashed()->where('build_update_id', $id)->pluck('id')->map(strval(...))->all();

            Reaction::query()->where('reactable_type', $update->getMorphClass())->where('reactable_id', $id)->delete();
            Mentions::forget($update);

            foreach ($commentIds as $commentId) {
                DB::table('mentions')->where('mentionable_type', (new Comment)->getMorphClass())->where('mentionable_id', $commentId)->delete();
            }

            VehicleHighlight::query()->where('item_type', HighlightItemType::BuildUpdate)->where('item_id', $id)->delete();
            VehicleHighlight::query()->where('item_type', HighlightItemType::Photo)->whereIn('item_id', $photos->pluck('id')->all())->delete();
            Collections::forgetItem(CollectionItemType::BuildUpdate, $id);

            $update->delete();
        });

        foreach ($photos as $photo) {
            $this->media->handle($photo);
        }
    }
}
