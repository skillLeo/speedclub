<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * R4-2.3 Crews (docs/reports/round-4/contract-crews.md §1): crews with members (founder, admins, members), open join requests and open
 * invitations. Requests and invitations are deleted once decided. Every FK and filter column is indexed; MySQL 8 and MariaDB 10.6.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('crews', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('name', 40);
            // Case-insensitive uniqueness; null once the crew is deleted, so the name is free again.
            $table->string('name_key', 60)->nullable()->unique();
            $table->string('slug', 64)->unique();
            $table->string('previous_slug', 64)->nullable()->index();
            $table->string('description', 500)->nullable();
            $table->foreignUlid('logo_media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->foreignUlid('cover_media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->char('bundesland', 2)->nullable()->index();
            $table->string('join_mode', 10)->index();
            $table->string('status', 10)->default('active');
            $table->string('status_before_removal', 10)->nullable();
            $table->timestamp('hidden_at')->nullable();
            $table->timestamp('removed_at')->nullable();
            $table->unsignedInteger('members_count')->default(0);
            $table->boolean('is_sample')->default(false)->index();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'deleted_at', 'is_sample', 'name']);
            $table->index(['status', 'deleted_at', 'is_sample', 'created_at']);
        });

        Schema::create('crew_members', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('crew_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 10);
            $table->unsignedTinyInteger('role_rank');
            $table->timestamp('joined_at');
            $table->timestamps();

            $table->unique(['crew_id', 'user_id']);
            $table->index(['user_id', 'role']);
            $table->index(['crew_id', 'role_rank', 'joined_at']);
        });

        Schema::create('crew_requests', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('crew_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['crew_id', 'user_id']);
            $table->index(['crew_id', 'created_at']);
        });

        Schema::create('crew_invites', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('crew_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['crew_id', 'user_id']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('crew_invites');
        Schema::dropIfExists('crew_requests');
        Schema::dropIfExists('crew_members');
        Schema::dropIfExists('crews');
    }
};
