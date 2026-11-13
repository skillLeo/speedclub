<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M4.15 (09 §8.13, ADR-452): the member web's Web Push subscriptions, one row per browser endpoint. The endpoint and both keys are
     * encrypted at rest (whoever holds them and the VAPID key can write to that browser); endpoint_hash (SHA-256 of the endpoint) makes
     * a registration idempotent per endpoint and moves a browser to the member who subscribed on it last. failures counts sends in a row
     * that failed for another reason than a gone subscription (404/410 removes the row at once). `browser` is "Chrome, macOS" from the user
     * agent the client sends; the user agent itself is not kept (only sessions and staff access store one). session_key ties the browser
     * to the sign-in that subscribed: SET-06 ending that browser (one, or all others) and its sign-out drop the subscription with it.
     */
    public function up(): void
    {
        Schema::create('push_subscriptions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            // SHA-256 of the member web session that subscribed (never the session id itself, which is a credential); null without one.
            $table->char('session_key', 64)->nullable()->index();
            $table->char('endpoint_hash', 64)->unique();
            $table->text('endpoint');
            $table->text('public_key');
            $table->text('auth_token');
            $table->string('content_encoding', 16)->default('aes128gcm');
            $table->string('browser', 40)->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->unsignedSmallInteger('failures')->default(0);
            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
    }
};
