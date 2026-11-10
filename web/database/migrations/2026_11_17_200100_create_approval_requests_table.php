<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Four-eyes engine (ADR-214, 06_ADMIN_SPEC §2). One row per request; it executes only in Approvals::approve(). payload is encrypted
 * (it may hold a member id or a filter), summary is what the approval queue shows. pending_key is set while the request is pending and
 * is unique, so one action on one subject can have only one pending request, even when two staff members ask at the same moment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approval_requests', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('action', 80);
            $table->string('subject_type', 40)->nullable();
            $table->string('subject_id', 26)->nullable();
            $table->text('payload');
            $table->json('summary');
            $table->string('reason', 1000);
            $table->foreignId('requested_by')->constrained('staff')->restrictOnDelete();
            $table->string('status', 16)->default('pending');
            $table->char('pending_key', 64)->nullable()->unique();
            $table->foreignId('decided_by')->nullable()->constrained('staff')->restrictOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_comment', 1000)->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('executed_at')->nullable();
            $table->json('result')->nullable();
            $table->timestamps();

            $table->index(['status', 'expires_at']);
            $table->index(['subject_type', 'subject_id']);
            $table->index('action');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_requests');
    }
};
