<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * M4.9 ruling (09 §11 "cost private"): costs are never public. Every modifications.cost_public goes back to false; the column stays
     * (older apps still send it, SaveModification ignores it) and no resource reads it any more. The costs themselves are untouched.
     */
    public function up(): void
    {
        DB::table('modifications')->where('cost_public', true)->update(['cost_public' => false]);
    }

    /**
     * Nothing to restore: which costs were public before is not kept, and none may be.
     */
    public function down(): void {}
};
