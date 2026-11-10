<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SET-08 shows the name the member blocked, as it was sent (lowercased), never the blocked member's live profile (M2.1 review #1): a live
 * name, display name or avatar would show changes across the other side's own block and reveal a new name after a block by the old one.
 * Existing rows take the blocked member's current username.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('blocks', function (Blueprint $table) {
            $table->string('blocked_username', 64)->nullable()->after('blocked_id');
        });

        DB::table('blocks')
            ->whereNull('blocked_username')
            ->update(['blocked_username' => DB::table('users')->whereColumn('users.id', 'blocks.blocked_id')->select('users.username')]);
    }

    public function down(): void
    {
        Schema::table('blocks', function (Blueprint $table) {
            $table->dropColumn('blocked_username');
        });
    }
};
