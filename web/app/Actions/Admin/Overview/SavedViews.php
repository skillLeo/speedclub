<?php

namespace App\Actions\Admin\Overview;

use App\Models\Staff;
use Illuminate\Support\Facades\DB;

/**
 * Reads the personal saved views of a DataTable (contract §2.3). Writes: SaveTableView, DeleteTableView.
 */
final class SavedViews
{
    public const MAX_PER_TABLE = 20;

    /**
     * @return list<array{id: string, name: string, query: array<string, mixed>}>
     */
    public static function for(Staff $staff, string $table): array
    {
        return array_values(DB::table('admin_saved_views')
            ->where('staff_id', $staff->id)
            ->where('table_key', $table)
            ->orderBy('name')
            ->limit(self::MAX_PER_TABLE)
            ->get(['id', 'name', 'query'])
            ->map(function (object $row): array {
                /** @var array<string, mixed> $query */
                $query = json_decode(is_string($row->query ?? null) ? $row->query : '{}', true) ?: [];

                return ['id' => (string) $row->id, 'name' => (string) $row->name, 'query' => $query];
            })
            ->all());
    }

    public static function count(Staff $staff, string $table): int
    {
        return DB::table('admin_saved_views')->where(['staff_id' => $staff->id, 'table_key' => $table])->count();
    }
}
