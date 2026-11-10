<?php

use App\Services\Audit\AuditChain;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_events', function (Blueprint $table) {
            $table->id();
            $table->timestamp('occurred_at', 6)->useCurrent()->index(); // useCurrent: MariaDB < 10.10 would otherwise add ON UPDATE to this column
            $table->string('actor_type', 20)->nullable();
            $table->string('actor_id', 26)->nullable();
            $table->string('action', 100)->index();
            $table->string('target_type', 60)->nullable();
            $table->string('target_id', 26)->nullable();
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->string('reason', 1000)->nullable();
            $table->string('request_id', 64)->nullable()->index();
            $table->char('prev_hash', 64)->nullable();
            $table->char('hash', 64)->unique();

            $table->index(['actor_type', 'actor_id']);
            $table->index(['target_type', 'target_id']);
        });

        // ADR-113: outside the hash chain, so that staff access data can be purged after 12 months without breaking it.
        Schema::create('audit_event_access', function (Blueprint $table) {
            $table->unsignedBigInteger('audit_event_id')->primary();
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->timestamp('occurred_at', 6)->useCurrent()->index();
        });

        // 05_ARCHITECTURE §13: reject changes in the database too, where the host allows triggers.
        foreach (AuditChain::triggerStatements() as $statement) {
            try {
                DB::unprepared($statement);
            } catch (QueryException) {
                // Host forbids TRIGGER. The application has no update path and one guarded archive path either way.
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_event_access');
        Schema::dropIfExists('audit_events');
    }
};
