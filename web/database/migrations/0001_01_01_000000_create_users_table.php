<?php

use App\Enums\PowerDisplay;
use App\Enums\ThemePreference;
use App\Enums\UserStatus;
use App\Enums\WhoCanMessage;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // avatar_media_id and cover_media_id get their foreign keys once media exists (garage tables).
        Schema::create('users', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->string('username', 24)->unique();
            $table->string('previous_username', 24)->nullable()->index();
            $table->timestamp('username_changed_at')->nullable();
            $table->string('display_name', 60)->nullable()->index();
            $table->string('city', 100)->nullable()->index();
            $table->string('bio', 500)->nullable();
            $table->ulid('avatar_media_id')->nullable()->index();
            $table->ulid('cover_media_id')->nullable()->index();
            $table->string('locale', 5)->default('de');
            $table->string('theme', 20)->default(ThemePreference::Carbon->value);
            $table->string('power_display', 20)->default(PowerDisplay::PsKw->value);
            $table->string('who_can_message', 20)->default(WhoCanMessage::Everyone->value);
            $table->boolean('discoverable')->default(true)->index();
            $table->boolean('indexable')->default(true)->index();
            $table->boolean('show_owner_on_qr')->default(true);
            $table->boolean('read_receipts')->default(true);
            $table->json('notification_prefs')->nullable();
            $table->text('two_factor_secret')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            $table->timestamp('two_factor_confirmed_at')->nullable();
            $table->string('status', 20)->default(UserStatus::Active->value)->index();
            $table->json('restrictions')->nullable();
            $table->boolean('force_password_change')->default(false);
            $table->timestamp('last_seen_at')->nullable()->index();
            $table->string('terms_version', 32)->nullable();
            $table->string('privacy_version', 32)->nullable();
            $table->timestamp('consented_at')->nullable();
            $table->timestamp('marketing_consent_at')->nullable();
            $table->timestamp('deletion_requested_at')->nullable()->index();
            $table->rememberToken();
            $table->timestamps();
            $table->softDeletes()->index();
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        // user_id holds a member ULID or, for sessions on the staff guard, a numeric staff id.
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('user_id', 26)->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('users');
    }
};
