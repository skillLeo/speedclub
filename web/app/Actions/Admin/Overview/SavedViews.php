<?php

namespace App\Actions\Admin\Overview;

use App\Models\Staff;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Reads the saved views of a DataTable (contract §2.3, 09 §10.2 "personal + shared"): the staff member's own views and the views a
 * colleague shared with one of the staff member's roles (`shared_role`). Writes: SaveTableView, DeleteTableView; only the author
 * changes or deletes a view.
 */
final class SavedViews
{
    public const MAX_PER_TABLE = 20;

    /**
     * Own views first (by name), then the shared ones of colleagues (by name, at most MAX_PER_TABLE more).
     *
     * @return list<array{id: string, name: string, query: array<string, mixed>, shared_role: string|null, mine: bool, author: string|null}>
     */
    public static function for(Staff $staff, string $table): array
    {
        /** @var list<string> $roles */
        $roles = $staff->getRoleNames()->map(fn (mixed $role): string => (string) $role)->values()->all();
        $map = function (stdClass $row) use ($staff): array {
            /** @var array<string, mixed> $query */
            $query = json_decode(is_string($row->query ?? null) ? $row->query : '{}', true) ?: [];
            $mine = (int) $row->staff_id === (int) $staff->id;

            return [
                'id' => (string) $row->id,
                'name' => (string) $row->name,
                'query' => $query,
                'shared_role' => is_string($row->shared_role) ? $row->shared_role : null,
                'mine' => $mine,
                'author' => $mine ? null : (is_string($row->author) ? $row->author : null),
            ];
        };
        $columns = ['admin_saved_views.id', 'admin_saved_views.name', 'admin_saved_views.query', 'admin_saved_views.shared_role', 'admin_saved_views.staff_id', 'staff.name as author'];
        $base = fn () => DB::table('admin_saved_views')->join('staff', 'staff.id', '=', 'admin_saved_views.staff_id')
            ->where('admin_saved_views.table_key', $table)->orderBy('admin_saved_views.name')->limit(self::MAX_PER_TABLE);

        $own = $base()->where('admin_saved_views.staff_id', $staff->id)->get($columns)->map($map)->all();
        $shared = $roles === [] ? [] : $base()->where('admin_saved_views.staff_id', '!=', $staff->id)
            ->whereIn('admin_saved_views.shared_role', $roles)->where('staff.status', 'active')->get($columns)->map($map)->all();

        return [...$own, ...$shared];
    }

    /**
     * The role a view of $staff is shared with: the staff member's first role (staff hold one role, 06 §2), or null without one.
     */
    public static function roleOf(Staff $staff): ?string
    {
        $role = $staff->getRoleNames()->first();

        return is_string($role) ? $role : null;
    }

    public static function count(Staff $staff, string $table): int
    {
        return DB::table('admin_saved_views')->where(['staff_id' => $staff->id, 'table_key' => $table])->count();
    }
}
