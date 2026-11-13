<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * M4.11 (09 §8.6): "Gespeichert" becomes the member's default collection. Every saved build moves into it in the order of saving (lists show
 * the highest position first, so the newest save leads, as on PROF-05). The saves stay (the owner's weekly aggregate counts them, ADR-139); from now on a save and a build in any of the member's
 * collections go together (App\Services\Social\Collections). Idempotent: a member who has a default collection already keeps it, and a
 * build already in it is skipped. Batched by member, so a large table never loads at once.
 */
return new class extends Migration
{
    private const BATCH = 500;

    public function up(): void
    {
        $after = '';

        while (true) {
            $members = DB::table('saves')->select('user_id')->distinct()->where('user_id', '>', $after)->orderBy('user_id')->limit(self::BATCH)->pluck('user_id')->map(strval(...))->all();

            if ($members === []) {
                return;
            }

            foreach ($members as $member) {
                DB::transaction(fn () => $this->move($member));
            }

            $after = (string) end($members);
        }
    }

    /**
     * Takes back exactly what up() added: default-collection items that are saved builds. A default collection left empty goes too; one
     * the member filled with other things since stays.
     */
    public function down(): void
    {
        $defaults = DB::table('member_collections')->where('is_default', true)->pluck('user_id', 'id');

        foreach ($defaults as $collectionId => $userId) {
            DB::table('member_collection_items')
                ->where('collection_id', $collectionId)
                ->where('item_type', 'vehicle')
                ->whereIn('item_id', DB::table('saves')->select('vehicle_id')->where('user_id', $userId))
                ->delete();

            if (! DB::table('member_collection_items')->where('collection_id', $collectionId)->exists()) {
                DB::table('member_collections')->where('id', $collectionId)->delete();
            }
        }
    }

    private function move(string $member): void
    {
        $collection = DB::table('member_collections')->where('user_id', $member)->where('is_default', true)->lockForUpdate()->value('id');

        if (! is_string($collection)) {
            $collection = strtolower((string) Str::ulid());
            DB::table('member_collections')->insert([
                'id' => $collection,
                'user_id' => $member,
                'name' => null,
                'is_default' => true,
                'position' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $saves = DB::table('saves')->where('user_id', $member)->orderBy('created_at')->orderBy('id')->get(['vehicle_id', 'created_at']);
        $position = (int) DB::table('member_collection_items')->where('collection_id', $collection)->max('position');
        $rows = [];

        foreach ($saves as $save) {
            $rows[] = [
                'collection_id' => $collection,
                'item_type' => 'vehicle',
                'item_id' => (string) $save->vehicle_id,
                'position' => ++$position,
                'created_at' => $save->created_at,
            ];
        }

        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('member_collection_items')->insertOrIgnore($chunk);
        }
    }
};
