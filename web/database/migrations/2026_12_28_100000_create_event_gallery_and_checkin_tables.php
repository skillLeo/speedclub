<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M5.6 Events page polish (10 §4, m5.6-contract §4.1, §5.1): the post-event gallery (photos through the member media pipeline, approved by
 * the organiser) and the check-in by the organiser's rotating code. A check-in stores who and when only: no location, device or IP
 * column, by design (10 §16 "nothing live", no exact locations). Plain columns and an index for every foreign key and filter: MySQL 8 and
 * MariaDB 10.6+. Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('event_photos', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            // The member media pipeline (re-encoded, EXIF stripped, WebP variants, blurhash, plate blur, ADR-509); one row per photo.
            $table->foreignUlid('media_id')->unique()->constrained('media')->cascadeOnDelete();
            $table->foreignUlid('uploader_id')->constrained('users')->cascadeOnDelete();
            $table->string('source', 12);
            $table->string('status', 12)->index();
            // The organiser who approved or rejected it.
            $table->foreignUlid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            // Shown to the uploader only.
            $table->string('reject_reason', 200)->nullable();
            // Set when staff took the photo down through a report (status removed); the decision itself is audited by DecideCase.
            $table->foreignId('removed_by_staff_id')->nullable()->constrained('staff')->nullOnDelete();
            // Approval order (oldest first); 0 until approved.
            $table->unsignedInteger('sort')->default(0);
            $table->boolean('is_sample')->default(false);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['event_id', 'status', 'sort']);
            $table->index(['event_id', 'uploader_id']);
            $table->index(['event_id', 'created_at']);
            $table->index(['status', 'reviewed_at']);
        });

        Schema::create('event_checkin_codes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->char('code', 6);
            $table->timestamp('expires_at');
            $table->timestamp('created_at')->nullable();

            $table->index(['event_id', 'expires_at']);
            $table->index('expires_at');
        });

        Schema::create('event_checkins', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->timestamp('checked_in_at');
            $table->boolean('profile_visible')->default(true);
            $table->string('method', 12);
            $table->timestamps();

            $table->unique(['event_id', 'user_id']);
            $table->index(['user_id', 'checked_in_at']);
            $table->index(['user_id', 'profile_visible']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_checkins');
        Schema::dropIfExists('event_checkin_codes');
        Schema::dropIfExists('event_photos');
    }
};
