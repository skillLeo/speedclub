<?php

use App\Enums\EventLocationVisibility;
use App\Enums\EventVisibility;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.12 Events and meets (09 §8.7, §11): events with their organiser (a member; business_id is filled by M4.14), the exact place and
 * a coarse area point (what everybody but the organiser and confirmed attendees sees of an after_rsvp place), RSVPs with the waitlist
 * and organiser updates. Plain columns and an index for every foreign key and filter: MySQL 8 and MariaDB 10.6+. Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('organiser_id')->constrained('users')->cascadeOnDelete();
            // M4.14 business organisers (verified businesses publish directly); no foreign key until that table exists.
            $table->char('business_id', 26)->nullable()->index();
            $table->string('slug', 140)->unique();
            $table->string('title', 120);
            $table->string('type', 20)->index();
            $table->string('status', 20);
            $table->string('visibility', 20)->default(EventVisibility::Public->value);
            $table->string('location_visibility', 20)->default(EventLocationVisibility::Public->value);
            // UTC; the event's own zone is Europe/Berlin (09 §8.7), kept for the calendar file and future zones.
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->string('timezone', 40)->default('Europe/Berlin');
            $table->string('venue_name', 120)->nullable();
            $table->string('street', 160)->nullable();
            $table->string('postcode', 10)->nullable();
            $table->string('city', 80)->nullable();
            $table->char('country', 2)->default('DE');
            $table->decimal('lat', 9, 6)->nullable();
            $table->decimal('lng', 9, 6)->nullable();
            // The exact point snapped to a grid of about 5 km (EventLocation::area): the pin and distance everybody may see.
            $table->decimal('area_lat', 9, 6)->nullable();
            $table->decimal('area_lng', 9, 6)->nullable();
            $table->foreignUlid('cover_media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->text('description')->nullable();
            $table->text('organiser_rules')->nullable();
            // EventRule values the organiser ticked (legal_only always).
            $table->json('rules')->nullable();
            $table->timestamp('rules_accepted_at')->nullable();
            $table->unsignedInteger('capacity')->nullable();
            $table->string('cancellation_reason', 500)->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->boolean('cancelled_by_staff')->default(false);
            // ADM-53/54: the staff decision on a pre-moderated event; the reason reaches the organiser on a rejection.
            $table->string('review_reason', 1000)->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('published_at')->nullable();
            // A moderation decision (report target event) took it down; the status before is kept for an appeal.
            $table->timestamp('removed_at')->nullable();
            $table->string('status_before_removal', 20)->nullable();
            // Reminders 24 h and 2 h before the start (events:reminders): set once every going member was told.
            $table->timestamp('reminded_24h_at')->nullable();
            $table->timestamp('reminded_2h_at')->nullable();
            $table->boolean('is_sample')->default(false)->index();
            $table->timestamps();

            $table->index(['status', 'visibility', 'starts_at']);
            $table->index(['status', 'ends_at']);
            $table->index(['organiser_id', 'status']);
            $table->index(['area_lat', 'area_lng']);
            $table->index(['status', 'submitted_at']);
        });

        Schema::create('event_rsvps', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('status', 20);
            // When the current status began: the waitlist is served in this order.
            $table->timestamp('status_at');
            // The organiser took the member off the list (EVT-06); they cannot answer again.
            $table->timestamp('removed_at')->nullable();
            $table->timestamps();

            $table->unique(['event_id', 'user_id']);
            $table->index(['event_id', 'status', 'status_at']);
            $table->index(['user_id', 'status']);
        });

        Schema::create('event_updates', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('event_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('author_id')->constrained('users')->cascadeOnDelete();
            $table->string('body', 1000);
            $table->timestamps();

            $table->index(['event_id', 'created_at']);
            $table->index('author_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_updates');
        Schema::dropIfExists('event_rsvps');
        Schema::dropIfExists('events');
    }
};
