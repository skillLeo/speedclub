<?php

namespace App\Services\Social;

use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Support\Facades\DB;

/**
 * The reader's own state on cards (M4.8 HOME-01, 09 §7.3): whether they saved the build or the update in one of their collections, and
 * their own private reaction. Batched per request: every FeedVehicleResource and BuildUpdateRowResource registers its item when it is
 * made, and the first lookup loads the state of everything registered so far in two queries (collections, reactions). A lookup of an
 * item nobody registered loads it alone. Kept on the request, so a later request never reads an old answer.
 *
 * Never anybody else's state, never a count (counts stay with the owner, ADR-413).
 */
final class ViewerStates
{
    private const KEY = 'speedclub.viewer_states';

    public function __construct(private readonly FeatureFlags $flags) {}

    /**
     * @param  'vehicle'|'build_update'  $type  the morph name (reactions) and item type (collections)
     */
    public static function register(string $type, string $id): void
    {
        $memo = self::memo();
        $key = $type.':'.$id;

        if (! array_key_exists($key, $memo->states)) {
            $memo->pending[$key] = [$type, $id];
        }
    }

    /**
     * @param  'vehicle'|'build_update'  $type
     * @return array{saved: bool, reaction: string|null}
     */
    public function of(?User $viewer, string $type, string $id): array
    {
        if ($viewer === null) {
            return ['saved' => false, 'reaction' => null];
        }

        $key = $type.':'.$id;
        $memo = self::memo();

        if (! array_key_exists($key, $memo->states)) {
            self::register($type, $id);
            $this->load($viewer, $memo);
        }

        return $memo->states[$key] ?? ['saved' => false, 'reaction' => null];
    }

    private function load(User $viewer, ViewerStateMemo $memo): void
    {
        $pending = array_values($memo->pending);

        if ($pending === []) {
            return;
        }

        $byType = ['vehicle' => [], 'build_update' => []];

        foreach ($pending as [$type, $id]) {
            $byType[$type][] = $id;
            $memo->states[$type.':'.$id] = ['saved' => false, 'reaction' => null];
        }

        $match = function ($query, string $typeColumn, string $idColumn) use ($byType): void {
            $query->where(function ($any) use ($byType, $typeColumn, $idColumn): void {
                foreach ($byType as $type => $ids) {
                    if ($ids !== []) {
                        $any->orWhere(fn ($one) => $one->where($typeColumn, $type)->whereIn($idColumn, $ids));
                    }
                }
            });
        };

        $saved = DB::table('member_collection_items as i')
            ->join('member_collections as c', 'c.id', '=', 'i.collection_id')
            ->where('c.user_id', $viewer->id)
            ->where(fn ($query) => $match($query, 'i.item_type', 'i.item_id'))
            ->distinct()
            ->get(['i.item_type', 'i.item_id']);

        foreach ($saved as $row) {
            $key = $row->item_type.':'.$row->item_id;
            $memo->states[$key] = ['saved' => true, 'reaction' => $memo->states[$key]['reaction'] ?? null];
        }

        if ($this->flags->enabled(Reactions::FLAG)) {
            $reactions = DB::table('reactions')->where('user_id', $viewer->id)
                ->where(fn ($query) => $match($query, 'reactable_type', 'reactable_id'))
                ->get(['reactable_type', 'reactable_id', 'type']);

            foreach ($reactions as $row) {
                $key = $row->reactable_type.':'.$row->reactable_id;
                $memo->states[$key] = ['saved' => $memo->states[$key]['saved'] ?? false, 'reaction' => (string) $row->type];
            }
        }

        $memo->pending = [];
    }

    private static function memo(): ViewerStateMemo
    {
        $memo = request()->attributes->get(self::KEY);

        if (! $memo instanceof ViewerStateMemo) {
            $memo = new ViewerStateMemo;
            request()->attributes->set(self::KEY, $memo);
        }

        return $memo;
    }
}
