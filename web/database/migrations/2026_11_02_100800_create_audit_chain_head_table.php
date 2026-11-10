<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One row that serialises writers of the audit chain and remembers its end. Locking this row by primary key takes
     * no gap locks, unlike SELECT … ORDER BY id DESC FOR UPDATE on audit_events, which deadlocks with the INSERT that
     * follows it. The lock lasts until the outermost commit, so a caller's open transaction cannot fork the chain.
     */
    public function up(): void
    {
        Schema::create('audit_chain_head', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedBigInteger('last_event_id')->nullable();
            $table->char('hash', 64)->nullable();
            // Where the chain now starts after old events moved to the archive (ADR-113).
            $table->unsignedBigInteger('archived_through_id')->nullable();
            $table->char('archived_hash', 64)->nullable();
        });

        DB::table('audit_chain_head')->insert(['id' => 1]);
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_chain_head');
    }
};
