<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * R5-5 (client round 5): comments on a car itself [build_comments], next to the comments on its build updates. A comment belongs to
 * exactly one thread: `build_update_id` or `vehicle_id`. That rule lives in App\Models\Comment (saving) and the posting Actions, not
 * in a CHECK constraint: MySQL 8 refuses a CHECK on a column whose foreign key has a referential action (error 3823), and both
 * columns cascade on delete. MySQL 8 and MariaDB 10.6+. Reversible (rolling back drops the car threads).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('comments', function (Blueprint $table) {
            $table->ulid('build_update_id')->nullable()->change();
            $table->foreignUlid('vehicle_id')->nullable()->after('build_update_id')->constrained()->cascadeOnDelete();

            $table->index(['vehicle_id', 'status', 'created_at']);
        });
    }

    public function down(): void
    {
        // Replies first: a car thread's replies point at its top-level comments.
        DB::table('comments')->whereNull('build_update_id')->whereNotNull('parent_id')->delete();
        DB::table('comments')->whereNull('build_update_id')->delete();

        Schema::table('comments', function (Blueprint $table) {
            $table->dropForeign(['vehicle_id']);
            $table->dropIndex(['vehicle_id', 'status', 'created_at']);
            $table->dropColumn('vehicle_id');
            $table->ulid('build_update_id')->nullable(false)->change();
        });
    }
};
