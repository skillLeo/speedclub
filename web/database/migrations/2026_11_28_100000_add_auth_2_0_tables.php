<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.6 Auth 2.0 (09 §8.1, §8.2, §11).
 *
 * login_attempts: one row per e-mail code (sign_in, link, reauth, change_email). The address is only a keyed hash, so the table names
 * nobody; the client's attempt id is a keyed hash too, and the magic-link token is bound to it. payload holds the encrypted provider
 * data of a pending AUTH-16 link. No network identifiers (ADR-113, the data-minimisation guard of
 * PhaseOneSecurityTest): the ip_trunc and user_agent of 09 §11 are left out; per-IP limits live in the rate limiter.
 *
 * social_accounts: Apple and Google subjects, unique per provider. member_passkeys: WebAuthn credentials of members (web-auth/webauthn-lib,
 * ADR-409); passkey_challenges: the server half of each ceremony, single use, 5 minutes.
 *
 * users: password is nullable for passwordless accounts; onboarding_state holds pending_terms until AUTH-09b; age_confirmed_at with the
 * accepted terms/privacy versions that already exist. personal_access_tokens.reauthenticated_at is the "sudo mode" stamp of 09 §8.1.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('login_attempts', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->char('email_hash', 64);
            $table->char('attempt_hash', 64)->index();
            $table->foreignUlid('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('purpose', 20);
            $table->char('code_hash', 64);
            $table->char('magic_hash', 64)->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at')->useCurrent();
            $table->timestamp('consumed_at')->nullable();
            $table->string('locale', 5)->nullable();
            $table->string('platform', 20)->nullable();
            $table->text('payload')->nullable();
            $table->timestamps();

            $table->index(['email_hash', 'created_at']);
            $table->index(['user_id', 'purpose', 'created_at']);
            $table->index('created_at');
        });

        Schema::create('social_accounts', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 10);
            $table->string('provider_sub', 255);
            $table->string('email')->nullable();
            $table->boolean('email_verified')->default(false);
            $table->boolean('is_private_relay')->default(false);
            $table->text('refresh_token_encrypted')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->unique(['provider', 'provider_sub']);
            $table->index(['user_id', 'provider']);
        });

        Schema::create('member_passkeys', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 64);
            $table->string('credential_id', 512)->unique();
            $table->json('credential');
            $table->char('aaguid', 36)->nullable();
            $table->json('transports')->nullable();
            $table->boolean('backup_eligible')->default(false);
            $table->boolean('backed_up')->default(false);
            $table->unsignedBigInteger('sign_count')->default(0);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });

        Schema::create('passkey_challenges', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('ceremony', 20);
            $table->json('options');
            $table->timestamp('expires_at')->useCurrent();
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();

            $table->index('expires_at');
            $table->index(['user_id', 'ceremony']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable()->change();
            $table->string('onboarding_state', 20)->nullable()->index()->after('status');
            $table->timestamp('age_confirmed_at')->nullable()->after('consented_at');
        });

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->timestamp('reauthenticated_at')->nullable()->after('last_used_at');
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropColumn('reauthenticated_at');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['onboarding_state']);
            $table->dropColumn(['onboarding_state', 'age_confirmed_at']);
        });

        Schema::dropIfExists('passkey_challenges');
        Schema::dropIfExists('member_passkeys');
        Schema::dropIfExists('social_accounts');
        Schema::dropIfExists('login_attempts');
    }
};
