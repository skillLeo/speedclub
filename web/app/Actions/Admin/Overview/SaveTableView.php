<?php

namespace App\Actions\Admin\Overview;

use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Saves a personal DataTable view, or replaces the staff member's view of the same name (contract §2.3). Audited.
 */
final class SaveTableView
{
    /**
     * @param  array<string, mixed>  $query
     * @return string the view id
     */
    public function __invoke(Staff $staff, string $table, string $name, array $query): string
    {
        return DB::transaction(function () use ($staff, $table, $name, $query): string {
            $existing = DB::table('admin_saved_views')
                ->where(['staff_id' => $staff->id, 'table_key' => $table, 'name' => $name])
                ->lockForUpdate()
                ->value('id');

            $id = is_string($existing) ? $existing : (string) Str::ulid();
            $now = now();

            DB::table('admin_saved_views')->updateOrInsert(
                ['id' => $id],
                [
                    'staff_id' => $staff->id,
                    'table_key' => $table,
                    'name' => $name,
                    'query' => json_encode($query, JSON_THROW_ON_ERROR),
                    'updated_at' => $now,
                    ...(is_string($existing) ? [] : ['created_at' => $now]),
                ],
            );

            Audit::record('admin.saved_view.saved', after: ['id' => $id, 'table' => $table, 'name' => $name, 'query' => $query], actor: $staff);

            return $id;
        });
    }
}
