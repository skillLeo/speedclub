<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M5.9b part 2 (10 §16, owner gift detail): the shared social push limit. The gift social types (spot_alert now; badge_unlocked,
 * car_of_the_day and invite_accepted with M5.9d) push at most once per member and Europe/Berlin day across all of them. A push claims the
 * member's day here first (the unique key decides between two writers at the same moment); App\Services\Notifications\SocialPushLimiter
 * is the only writer and prunes rows after a week.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('social_push_claims', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            // The Europe/Berlin day the push went out on.
            $table->date('day');
            // The notification type that used the day, for support questions ("why no push for my badge?").
            $table->string('type', 40);
            $table->ulid('notification_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'day'], 'social_push_claims_user_day_unique');
            $table->index('day', 'social_push_claims_day_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('social_push_claims');
    }
};
