<?php

use App\Enums\BusinessStatus;
use App\Enums\ModTagStatus;
use App\Enums\ProductStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.14 Parts, brands and businesses (09 §8.9, §8.10, §11; ADR-414):
 * - brands gain what BRD-01 shows: a short "about" per language, the official website and the country;
 * - products of the parts catalogue (brand, mod category, name, product line, attributes, official and affiliate link, status, merges);
 * - businesses with their § 5 DDG Impressum fields, the staff decision columns and is_sample; business_members (owner, staff);
 * - mod_business_tags ("Eingebaut von", double confirmation) and business_view_days (BIZ-03's private 30-day views, no personal data);
 * - modifications gain product_id and installed_by_business_id (set only once a tag is accepted by both sides).
 * Plain columns and an index for every foreign key and filter: MySQL 8 and MariaDB 10.6+. Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('brands', function (Blueprint $table) {
            // {"de": "...", "en": "..."}; facts from the catalogue data file only (database/data/products.json).
            $table->json('about')->nullable()->after('aliases');
            $table->string('website', 300)->nullable()->after('about');
            $table->char('country', 2)->nullable()->after('website');
        });

        Schema::create('products', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignId('brand_id')->constrained('brands')->restrictOnDelete();
            $table->foreignId('category_id')->constrained('mod_categories')->restrictOnDelete();
            $table->string('name', 160);
            // The brand's product line ("Variante 3", "CH-R"); null when the name is the line.
            $table->string('line', 120)->nullable();
            // Unique within the brand: "kw/variante-3".
            $table->string('slug', 180);
            // Key attributes for BRD-02's table: {"de": {"Bauart": "Gewindefahrwerk"}, "en": {...}}; only facts from the data file or staff.
            $table->json('attributes')->nullable();
            $table->string('url', 500)->nullable();
            // Shown only while affiliate_links is on, labelled "Anzeige" with rel="sponsored" (UWG).
            $table->string('affiliate_url', 500)->nullable();
            $table->foreignUlid('image_media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->string('status', 20)->default(ProductStatus::Active->value);
            $table->json('aliases')->nullable();
            $table->foreignUlid('merged_into_id')->nullable()->constrained('products')->nullOnDelete();
            $table->timestamps();

            $table->unique(['brand_id', 'slug']);
            $table->index(['status', 'name']);
            $table->index(['category_id', 'status']);
            $table->index('merged_into_id');
        });

        Schema::create('businesses', function (Blueprint $table) {
            $table->ulid('id')->primary();
            // The applicant: owner of the profile (also in business_members as owner).
            $table->foreignUlid('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('slug', 140)->unique();
            $table->string('name', 120);
            $table->string('kind', 20)->index();
            // Impressum (§ 5 DDG).
            $table->string('legal_name', 160);
            $table->string('legal_form', 20);
            $table->string('representative', 160)->nullable();
            $table->string('street', 160);
            $table->string('postcode', 10);
            $table->string('city', 80)->index();
            $table->char('country', 2)->default('DE');
            $table->decimal('lat', 9, 6)->nullable();
            $table->decimal('lng', 9, 6)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('email', 160);
            $table->string('website', 300)->nullable();
            $table->string('register_court', 120)->nullable();
            $table->string('register_number', 60)->nullable();
            $table->string('vat_id', 20)->nullable();
            // Profile.
            $table->text('about')->nullable();
            $table->json('services')->nullable();
            // {"mon": [["09:00", "18:00"]], ...}; a day without entries is closed.
            $table->json('opening_hours')->nullable();
            $table->foreignUlid('logo_media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->foreignUlid('cover_media_id')->nullable()->constrained('media')->nullOnDelete();
            // BIZ-02 "Nachweise": what the applicant can show staff on request; never public.
            $table->string('document_note', 1000)->nullable();
            // Staff decisions (ADM-55/56).
            $table->string('status', 20)->default(BusinessStatus::Applied->value);
            $table->timestamp('submitted_at')->nullable();
            $table->string('review_reason', 1000)->nullable();
            $table->foreignId('reviewed_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->foreignId('verified_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('suspended_at')->nullable();
            // A moderation decision (report target business) took it down; the status before is kept for an appeal.
            $table->timestamp('removed_at')->nullable();
            $table->string('status_before_removal', 20)->nullable();
            $table->boolean('is_sample')->default(false)->index();
            $table->timestamps();

            $table->index(['status', 'submitted_at']);
            $table->index(['status', 'city']);
            $table->index('owner_id');
        });

        Schema::create('business_members', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('business_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 20);
            $table->timestamps();

            $table->unique(['business_id', 'user_id']);
            // One business per member (BIZ-02: "Pro Konto ein Betrieb").
            $table->unique('user_id');
        });

        Schema::create('mod_business_tags', function (Blueprint $table) {
            $table->ulid('id')->primary();
            // One "Eingebaut von" per mod.
            $table->foreignUlid('mod_id')->unique()->constrained('modifications')->cascadeOnDelete();
            $table->foreignUlid('business_id')->constrained()->cascadeOnDelete();
            $table->string('status', 20)->default(ModTagStatus::Pending->value);
            $table->string('initiated_by', 20);
            $table->foreignUlid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->index(['business_id', 'status', 'created_at']);
            $table->index('requested_by');
            $table->index('decided_by');
        });

        Schema::create('business_view_days', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('business_id')->constrained()->cascadeOnDelete();
            $table->date('day');
            $table->unsignedInteger('views')->default(0);

            $table->unique(['business_id', 'day']);
        });

        Schema::table('modifications', function (Blueprint $table) {
            $table->foreignUlid('product_id')->nullable()->after('brand_text')->constrained('products')->nullOnDelete();
            $table->foreignUlid('installed_by_business_id')->nullable()->after('product_id')->constrained('businesses')->nullOnDelete();
        });

        // The events table reserved business_id (M4.12) without a key until this table existed.
        Schema::table('events', function (Blueprint $table) {
            $table->foreign('business_id')->references('id')->on('businesses')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropForeign(['business_id']);
        });

        Schema::table('modifications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('installed_by_business_id');
            $table->dropConstrainedForeignId('product_id');
        });

        Schema::dropIfExists('business_view_days');
        Schema::dropIfExists('mod_business_tags');
        Schema::dropIfExists('business_members');
        Schema::dropIfExists('businesses');
        Schema::dropIfExists('products');

        Schema::table('brands', function (Blueprint $table) {
            $table->dropColumn(['about', 'website', 'country']);
        });
    }
};
