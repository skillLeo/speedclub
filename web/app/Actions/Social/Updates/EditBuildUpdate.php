<?php

namespace App\Actions\Social\Updates;

use App\Enums\BuildUpdateAudience;
use App\Enums\KeywordField;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Services\Rules\ContentScreen;
use App\Services\Social\BuildUpdateMentions;
use Illuminate\Support\Facades\DB;

/**
 * Edits an own post within 24 hours (09 §8.5; BuildUpdatePolicy::edit): any subset of text, mileage, date, audience, linked mods, photo
 * order and before/after pairs. A real change stamps edited_at, which the app shows as "bearbeitet". New mentions notify; a mention taken
 * out is removed.
 */
class EditBuildUpdate
{
    public function __construct(
        private readonly ContentScreen $screen,
        private readonly BuildUpdateMentions $mentions,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated (UpdateBuildUpdatePostRequest)
     */
    public function handle(BuildUpdate $update, User $owner, array $data): BuildUpdate
    {
        $hasText = array_key_exists('text', $data);
        $text = $hasText ? PostBuildUpdate::text(is_string($data['text']) ? $data['text'] : null) : null;
        $flags = $hasText && $text !== null ? $this->screen->screen(['text' => [KeywordField::BuildNote, $text]]) : [];

        DB::transaction(function () use ($update, $owner, $data, $hasText, $text): void {
            BuildUpdate::query()->whereKey($update->getKey())->lockForUpdate()->value('id');
            $changed = false;

            if ($hasText) {
                $update->setAttribute('note', $text);
            }

            foreach (['mileage_km', 'happened_on'] as $field) {
                if (array_key_exists($field, $data)) {
                    $update->setAttribute($field, $data[$field]);
                }
            }

            if (array_key_exists('audience', $data)) {
                $update->setAttribute('audience', BuildUpdateAudience::from((string) $data['audience']));
            }

            if (array_key_exists('photo_pairs', $data)) {
                /** @var list<array{0: string, 1: string}> $pairs */
                $pairs = $data['photo_pairs'];
                $update->setAttribute('photo_pairs', $pairs === [] ? null : $pairs);
            }

            $changed = $update->isDirty();

            if (array_key_exists('modification_ids', $data)) {
                /** @var list<string> $ids */
                $ids = $data['modification_ids'];
                $before = $update->modifications()->pluck('modifications.id')->map(strval(...))->all();
                PostBuildUpdate::syncMods($update, $ids);
                $changed = $changed || $before !== $ids;
            }

            if (array_key_exists('photo_order', $data)) {
                /** @var list<string> $order */
                $order = $data['photo_order'];

                foreach ($order as $position => $id) {
                    $changed = Media::query()->whereKey($id)->where('mediable_type', $update->getMorphClass())->where('mediable_id', $update->getKey())
                        ->where('sort', '!=', $position)->update(['sort' => $position]) > 0 || $changed;
                }
            }

            if ($changed) {
                $update->setAttribute('edited_at', now());
            }

            $update->save();

            if ($hasText) {
                $this->mentions->afterSave($update, $owner, $text);
            }
        });

        $this->screen->flagAfterCommit($flags, $update);

        return $update->refresh();
    }
}
