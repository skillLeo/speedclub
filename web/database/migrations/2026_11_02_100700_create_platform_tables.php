<?php

use App\Enums\ConfigVersionStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('config_versions', function (Blueprint $table) {
            $table->id();
            $table->string('key', 60);
            $table->unsignedInteger('version');
            $table->string('status', 20)->default(ConfigVersionStatus::Draft->value);
            $table->json('payload');
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('published_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('published_at')->nullable();
            $table->string('reason', 1000)->nullable();
            $table->timestamps();

            $table->unique(['key', 'version']);
            $table->index(['key', 'status']);
            $table->index('status');
        });

        Schema::create('feature_flags', function (Blueprint $table) {
            $table->id();
            $table->string('key', 80)->unique();
            $table->boolean('enabled')->default(false)->index();
            $table->json('rules')->nullable();
            $table->string('description', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('legal_documents', function (Blueprint $table) {
            $table->id();
            $table->string('key', 30);
            $table->string('locale', 5);
            $table->string('version', 32);
            $table->longText('body_md');
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique(['key', 'locale', 'version']);
            $table->index(['key', 'locale', 'published_at']);
        });

        // Only authenticated routes use these: replays are scoped to the member, the route and the key.
        // response_status stays null while the first request is still running.
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->string('key', 128);
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('route', 191);
            $table->char('request_hash', 64)->nullable();
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->longText('response_body')->nullable();
            $table->json('response_headers')->nullable();
            $table->timestamp('expires_at')->useCurrent()->index(); // useCurrent: MariaDB < 10.10 would otherwise add ON UPDATE to this column
            $table->timestamps();

            $table->unique(['user_id', 'route', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
        Schema::dropIfExists('legal_documents');
        Schema::dropIfExists('feature_flags');
        Schema::dropIfExists('config_versions');
    }
};
