<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A member chooses the username after verifying the e-mail address (F1, AUTH-08); NULL never collides in the unique index.
        Schema::table('users', function (Blueprint $table) {
            $table->string('username', 24)->nullable()->change();
            $table->timestamp('profile_setup_at')->nullable()->after('bio');
        });

        // A device this account has seen, so a login after a sign-out is not "new". Only a checksum: no IP, no user agent.
        Schema::create('known_devices', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->char('fingerprint', 64);
            $table->timestamp('last_seen_at')->useCurrent()->index(); // useCurrent: MariaDB < 10.10 would otherwise add ON UPDATE to this column
            $table->timestamps();

            $table->unique(['user_id', 'fingerprint']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('known_devices');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('profile_setup_at');
        });
    }
};
