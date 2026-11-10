<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.5 Brand, content, configuration (m3.5 contract §1, §1a; 06_ADMIN_SPEC §1.5, §3 Brand & content, Configuration & releases):
 *
 * - config_versions: `revision` (the draft's edit counter, the optimistic check of App\Services\Config\ConfigVersions) and `base_version`
 *   (the live version a draft started from, so the page can say the live config moved since).
 * - brand_assets: logo set, hero, splash and OG images uploaded in ADM-28. Re-encoded (EXIF gone), the original on the private disk,
 *   WebP variants public. Never deleted while a config version may name them (a rollback must find them).
 * - legal_documents: `requires_reconsent`, the changes `summary` the app's re-consent sheet shows, who drafted and published it, the
 *   publish reason.
 * - help_articles: `category` (ADM-32).
 * - message_templates: overrides of the editable e-mail and push texts (ADM-33), per template key and locale.
 * - releases: the release register (ADM-38), filled by hand or by `speedclub:releases-sync` from docs/RELEASES.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('config_versions', function (Blueprint $table) {
            $table->unsignedInteger('revision')->default(1)->after('status');
            $table->unsignedInteger('base_version')->nullable()->after('revision');
        });

        Schema::create('brand_assets', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('kind', 24)->index();
            $table->string('original_path');
            $table->json('variants');
            // Logos only: a PNG for mail clients that show no WebP. OG only: the 1200×630 JPEG crawlers read.
            $table->string('png_path')->nullable();
            $table->string('og_path')->nullable();
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->string('blurhash', 64)->nullable();
            $table->unsignedInteger('bytes');
            $table->char('sha256', 64)->index();
            $table->foreignId('uploaded_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();

            $table->index('created_at');
        });

        Schema::table('legal_documents', function (Blueprint $table) {
            $table->boolean('requires_reconsent')->default(false)->after('body_md');
            $table->string('summary', 1000)->nullable()->after('requires_reconsent');
            $table->foreignId('created_by')->nullable()->after('published_at')->constrained('staff')->nullOnDelete();
            $table->foreignId('published_by')->nullable()->after('created_by')->constrained('staff')->nullOnDelete();
            $table->string('reason', 1000)->nullable()->after('published_by');

            $table->index(['key', 'requires_reconsent', 'published_at']);
        });

        Schema::table('help_articles', function (Blueprint $table) {
            $table->string('category', 32)->nullable()->after('locale');

            $table->index(['locale', 'category']);
        });

        Schema::create('message_templates', function (Blueprint $table) {
            $table->id();
            $table->string('key', 80);
            $table->string('locale', 5);
            $table->json('fields');
            $table->foreignId('updated_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();

            $table->unique(['key', 'locale']);
        });

        Schema::create('releases', function (Blueprint $table) {
            $table->id();
            $table->string('version_name', 32);
            $table->unsignedInteger('version_code');
            $table->string('platform', 16)->index();
            $table->string('channel', 16)->index();
            $table->char('apk_sha256', 64)->nullable();
            $table->text('notes')->nullable();
            $table->timestamp('released_at')->nullable()->index();
            $table->string('source', 16);
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();

            $table->unique(['version_name', 'version_code', 'channel', 'platform']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('releases');
        Schema::dropIfExists('message_templates');

        Schema::table('help_articles', function (Blueprint $table) {
            $table->dropIndex(['locale', 'category']);
            $table->dropColumn('category');
        });

        Schema::table('legal_documents', function (Blueprint $table) {
            $table->dropIndex(['key', 'requires_reconsent', 'published_at']);
            $table->dropConstrainedForeignId('created_by');
            $table->dropConstrainedForeignId('published_by');
            $table->dropColumn(['requires_reconsent', 'summary', 'reason']);
        });

        Schema::dropIfExists('brand_assets');

        Schema::table('config_versions', function (Blueprint $table) {
            $table->dropColumn(['revision', 'base_version']);
        });
    }
};
