<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M2.1 lists: followers and following (PROF-04), blocked accounts (SET-08) and saved builds (PROF-05), each newest first by the row's
 * created_at, then its id. created_at becomes NOT NULL with the current time as default: a cursor over a null value fails (ValidCursor),
 * and a pivot attached without the column (tests, tinker) would otherwise sort nowhere. Each list reads its own index backwards;
 * InnoDB appends the primary key, so the id tie-break is part of it.
 */
return new class extends Migration
{
    private const TABLES = [
        'follows' => ['follower_id', 'created_at'],
        'blocks' => ['blocker_id', 'created_at'],
        'saves' => ['user_id', 'created_at'],
    ];

    public function up(): void
    {
        foreach (self::TABLES as $table => $index) {
            DB::table($table)->whereNull('created_at')->update(['created_at' => now()]);

            Schema::table($table, function (Blueprint $blueprint) use ($index): void {
                $blueprint->timestamp('created_at')->useCurrent()->change();
                $blueprint->index($index);
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table => $index) {
            Schema::table($table, function (Blueprint $blueprint) use ($index): void {
                $blueprint->dropIndex($index);
                $blueprint->timestamp('created_at')->nullable()->change();
            });
        }
    }
};
