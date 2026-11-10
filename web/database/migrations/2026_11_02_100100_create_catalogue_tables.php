<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('makes', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('slug', 120)->unique();
            $table->string('country', 2)->nullable()->index();
            $table->boolean('is_popular')->default(false)->index();
            $table->unsignedInteger('sort')->default(0);
            $table->boolean('active')->default(true)->index();
            $table->timestamps();
        });

        Schema::create('vehicle_models', function (Blueprint $table) {
            $table->id();
            $table->foreignId('make_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('slug', 120);
            $table->boolean('active')->default(true)->index();
            $table->timestamps();

            $table->unique(['make_id', 'slug']);
            $table->index('slug');
        });

        Schema::create('generations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('model_id')->constrained('vehicle_models')->restrictOnDelete();
            $table->string('name', 100);
            $table->unsignedSmallInteger('year_from')->nullable();
            $table->unsignedSmallInteger('year_to')->nullable();
            $table->string('slug', 120);
            $table->timestamps();

            $table->unique(['model_id', 'slug']);
        });

        Schema::create('brands', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120)->index();
            $table->string('slug', 140)->unique();
            $table->string('category_hint', 40)->nullable()->index();
            $table->json('aliases')->nullable();
            $table->foreignId('merged_into_id')->nullable()->constrained('brands')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('mod_categories', function (Blueprint $table) {
            $table->id();
            $table->string('key', 40)->unique();
            $table->json('name');
            $table->string('icon', 60)->nullable();
            $table->unsignedInteger('sort')->default(0);
            $table->boolean('active')->default(true)->index();
            $table->timestamps();
        });

        Schema::create('mod_category_fields', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained('mod_categories')->cascadeOnDelete();
            $table->string('key', 60);
            $table->json('label');
            $table->string('type', 20)->index();
            $table->string('unit', 20)->nullable();
            $table->decimal('min', 10, 2)->nullable();
            $table->decimal('max', 10, 2)->nullable();
            $table->decimal('step', 10, 2)->nullable();
            $table->json('options')->nullable();
            $table->boolean('required')->default(false);
            $table->boolean('searchable')->default(false)->index();
            $table->boolean('facet')->default(false)->index();
            $table->unsignedInteger('sort')->default(0);
            $table->timestamps();

            $table->unique(['category_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mod_category_fields');
        Schema::dropIfExists('mod_categories');
        Schema::dropIfExists('brands');
        Schema::dropIfExists('generations');
        Schema::dropIfExists('vehicle_models');
        Schema::dropIfExists('makes');
    }
};
