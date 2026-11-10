<?php

use App\Enums\CatalogRequestStatus;
use App\Enums\LegalStatus;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // cover_media_id gets its foreign key below, once media exists.
        Schema::create('vehicles', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('owner_id')->constrained('users')->cascadeOnDelete();
            $table->char('public_id', 8)->unique();
            $table->string('slug', 140)->index();
            $table->string('status', 20)->default(VehicleStatus::Draft->value)->index();
            $table->string('visibility', 20)->default(Visibility::Public->value)->index();
            $table->boolean('is_main')->default(false);
            $table->unsignedInteger('sort')->default(0);
            $table->string('nickname', 60)->nullable();
            $table->string('description', 500)->nullable();
            $table->string('color', 60)->nullable();
            $table->ulid('cover_media_id')->nullable()->index();
            $table->foreignId('make_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('model_id')->nullable()->constrained('vehicle_models')->restrictOnDelete();
            $table->foreignId('generation_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('make_text', 100)->nullable();
            $table->string('model_text', 100)->nullable();
            $table->unsignedSmallInteger('model_year')->nullable()->index();
            $table->date('hu_au_due')->nullable()->index();
            $table->timestamp('published_at')->nullable()->index();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();
            $table->softDeletes()->index();

            $table->index(['owner_id', 'status', 'visibility']);
            $table->index(['owner_id', 'is_main']);
            $table->index(['owner_id', 'sort']);
        });

        Schema::create('vehicle_specs', function (Blueprint $table) {
            $table->foreignUlid('vehicle_id')->primary()->constrained()->cascadeOnDelete();
            $table->string('engine_code', 40)->nullable()->index();
            $table->string('engine_text', 100)->nullable();
            $table->unsignedMediumInteger('displacement_cc')->nullable();
            $table->string('fuel', 20)->nullable()->index();
            $table->string('aspiration', 30)->nullable()->index();
            $table->decimal('power_value', 7, 2)->nullable();
            $table->string('power_unit', 5)->nullable();
            $table->string('power_source', 20)->nullable();
            $table->decimal('power_ps', 7, 2)->nullable()->index();
            $table->unsignedSmallInteger('torque_nm')->nullable();
            $table->string('torque_source', 20)->nullable();
            $table->string('drivetrain', 20)->nullable()->index();
            $table->string('gearbox', 20)->nullable()->index();
            $table->timestamps();
        });

        Schema::create('modifications', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignId('category_id')->constrained('mod_categories')->restrictOnDelete();
            $table->string('title', 160);
            $table->foreignId('brand_id')->nullable()->constrained()->nullOnDelete();
            $table->string('brand_text', 120)->nullable();
            $table->string('part_name', 160)->nullable();
            $table->string('part_number', 80)->nullable();
            $table->string('status', 20)->default(ModStatus::Installed->value)->index();
            $table->date('installed_on')->nullable();
            $table->unsignedInteger('cost_cents')->nullable();
            $table->boolean('cost_public')->default(false);
            $table->string('legal_status', 30)->default(LegalStatus::Unknown->value)->index();
            $table->string('notes', 500)->nullable();
            $table->json('fields')->nullable();
            $table->unsignedInteger('sort')->default(0);
            $table->timestamps();
            $table->softDeletes()->index();

            $table->index(['vehicle_id', 'sort']);
        });

        // mediable stays null until an upload is attached; unattached uploads are pruned after 24 h.
        Schema::create('media', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('owner_id')->constrained('users')->cascadeOnDelete();
            $table->nullableUlidMorphs('mediable');
            $table->string('disk', 40);
            $table->string('original_path')->nullable();
            $table->json('variants')->nullable();
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->string('blurhash', 64)->nullable();
            $table->decimal('focal_x', 4, 3)->nullable();
            $table->decimal('focal_y', 4, 3)->nullable();
            $table->string('alt', 500)->nullable();
            $table->string('category', 20)->default(MediaCategory::Other->value)->index();
            $table->unsignedInteger('sort')->default(0);
            $table->string('status', 20)->default(MediaStatus::Processing->value)->index();
            $table->string('moderation_status', 20)->default(ModerationStatus::Pending->value)->index();
            $table->json('ai_tags')->nullable();
            $table->timestamps();
            $table->softDeletes()->index();

            $table->index(['mediable_type', 'mediable_id', 'sort']);
        });

        Schema::create('build_updates', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->string('type', 20)->index();
            $table->json('payload')->nullable();
            $table->string('note', 500)->nullable();
            $table->boolean('hidden')->default(false);
            $table->timestamp('created_at')->nullable()->index();

            $table->index(['vehicle_id', 'hidden', 'created_at']);
        });

        Schema::create('catalog_requests', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('vehicle_id')->nullable()->constrained()->nullOnDelete();
            $table->string('make_text', 100)->nullable();
            $table->string('model_text', 100)->nullable();
            $table->string('generation_text', 100)->nullable();
            $table->string('status', 20)->default(CatalogRequestStatus::Pending->value)->index();
            $table->string('rejection_reason', 500)->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreign('avatar_media_id')->references('id')->on('media')->nullOnDelete();
            $table->foreign('cover_media_id')->references('id')->on('media')->nullOnDelete();
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->foreign('cover_media_id')->references('id')->on('media')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropForeign(['cover_media_id']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['avatar_media_id']);
            $table->dropForeign(['cover_media_id']);
        });

        Schema::dropIfExists('catalog_requests');
        Schema::dropIfExists('build_updates');
        Schema::dropIfExists('media');
        Schema::dropIfExists('modifications');
        Schema::dropIfExists('vehicle_specs');
        Schema::dropIfExists('vehicles');
    }
};
