<?php

namespace App\Services\Showcase;

use App\Enums\EventStatus;
use App\Enums\SampleItemType;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * ADM-58 Redaktion & Beispiele (M4.17): what the admin reads about the sample content. Admin counts and records, never shown to members.
 */
final class SampleInventory
{
    /**
     * The open ADM-58 hides of these items, keyed by item id: when, by whom (the staff member's name) and why.
     *
     * @param  list<string>  $ids
     * @return Collection<string, stdClass>
     */
    public static function hiddenRecords(SampleItemType $type, array $ids): Collection
    {
        if ($ids === []) {
            return collect();
        }

        /** @var Collection<string, stdClass> */
        return DB::table('sample_hidden_items')
            ->leftJoin('staff', 'staff.id', '=', 'sample_hidden_items.hidden_by')
            ->where('subject_type', $type->value)->whereIn('subject_id', $ids)->whereNull('restored_at')
            ->get(['subject_id', 'hidden_at', 'reason', 'staff.name as by'])->keyBy('subject_id');
    }

    /**
     * What there is, per kind: sample members (the Editorial account among them), builds, build updates, meets and businesses, and how
     * many items ADM-58 has hidden.
     *
     * @return array<string, int>
     */
    public static function summary(): array
    {
        $sampleOwner = fn (string $table, string $column) => fn (Builder $q) => $q->where("$table.is_sample", true)
            ->orWhereExists(fn (Builder $owner) => $owner->selectRaw('1')->from('users')->whereColumn('users.id', "$table.$column")->where('users.is_sample', true));

        return [
            'members' => DB::table('users')->whereNull('deleted_at')->where('is_sample', true)->count(),
            'vehicles' => DB::table('vehicles')->whereNull('deleted_at')->where($sampleOwner('vehicles', 'owner_id'))->count(),
            'updates' => DB::table('build_updates')->where('is_sample', true)->count(),
            'events' => DB::table('events')->where('status', '!=', EventStatus::Draft->value)->where($sampleOwner('events', 'organiser_id'))->count(),
            'businesses' => DB::table('businesses')->where($sampleOwner('businesses', 'owner_id'))->count(),
            'hidden' => DB::table('sample_hidden_items')->whereNull('restored_at')->count(),
        ];
    }

    /**
     * The Editorial account (the one member with is_editorial), if it exists.
     *
     * @return array{id: string, username: string|null}|null
     */
    public static function editorialAccount(): ?array
    {
        $row = DB::table('users')->where('is_editorial', true)->whereNull('deleted_at')->first(['id', 'username']);

        return $row === null ? null : ['id' => (string) $row->id, 'username' => $row->username];
    }
}
