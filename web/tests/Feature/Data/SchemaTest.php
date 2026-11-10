<?php

use App\Enums\PowerUnit;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BrandAsset;
use App\Models\BuildUpdate;
use App\Models\CatalogImport;
use App\Models\CatalogRequest;
use App\Models\ConfigVersion;
use App\Models\DiscoverCollection;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\IdempotencyKey;
use App\Models\LegalDocument;
use App\Models\Make;
use App\Models\Media;
use App\Models\MessageTemplate;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModCategorySchemaVersion;
use App\Models\Modification;
use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Release;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Models\VerificationCode;
use App\Support\Units;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Schema;
use Tests\Support\SourceScanner;

$tables = [
    'users', 'personal_access_tokens', 'sessions', 'verification_codes', 'push_tokens', 'follows', 'blocks', 'saves',
    'makes', 'vehicle_models', 'generations', 'brands', 'mod_categories', 'mod_category_fields', 'catalog_requests',
    'vehicles', 'vehicle_specs', 'modifications', 'media', 'build_updates', 'qr_codes', 'qr_scan_daily',
    'vehicle_search', 'audit_events', 'config_versions', 'feature_flags', 'legal_documents', 'idempotency_keys',
];

it('creates every table of the data layer', function (string $table) {
    expect(Schema::hasTable($table))->toBeTrue();
})->with($tables);

it('has the specified columns', function (string $table, array $columns) {
    expect(array_diff($columns, Schema::getColumnListing($table)))->toBe([]);
})->with([
    'users' => ['users', [
        'id', 'email', 'email_verified_at', 'password', 'username', 'previous_username', 'username_changed_at', 'display_name',
        'city', 'bio', 'avatar_media_id', 'cover_media_id', 'locale', 'theme', 'power_display', 'who_can_message',
        'discoverable', 'indexable', 'show_owner_on_qr', 'read_receipts', 'notification_prefs', 'two_factor_secret',
        'two_factor_recovery_codes', 'two_factor_confirmed_at', 'status', 'restrictions', 'force_password_change',
        'last_seen_at', 'terms_version', 'privacy_version', 'consented_at', 'marketing_consent_at', 'deletion_requested_at',
        'deleted_at', 'profile_setup_at',
    ]],
    'personal_access_tokens' => ['personal_access_tokens', ['device_name', 'platform', 'app_version', 'expires_at']],
    'verification_codes' => ['verification_codes', ['user_id', 'email', 'purpose', 'code_hash', 'attempts', 'expires_at', 'consumed_at']],
    'push_tokens' => ['push_tokens', ['user_id', 'token', 'platform', 'device_id', 'last_used_at']],
    'makes' => ['makes', ['name', 'slug', 'country', 'is_popular', 'sort', 'active']],
    'vehicle_models' => ['vehicle_models', ['make_id', 'name', 'slug', 'active']],
    'generations' => ['generations', ['model_id', 'name', 'year_from', 'year_to', 'slug']],
    'brands' => ['brands', ['name', 'slug', 'category_hint', 'aliases', 'merged_into_id']],
    'mod_categories' => ['mod_categories', ['key', 'name', 'icon', 'sort', 'active']],
    'mod_category_fields' => ['mod_category_fields', ['category_id', 'key', 'label', 'type', 'unit', 'min', 'max', 'step', 'options', 'required', 'searchable', 'facet', 'sort']],
    'vehicles' => ['vehicles', [
        'id', 'owner_id', 'public_id', 'slug', 'status', 'visibility', 'is_main', 'sort', 'nickname', 'description', 'color',
        'cover_media_id', 'make_id', 'model_id', 'generation_id', 'make_text', 'model_text', 'model_year', 'hu_au_due',
        'published_at', 'archived_at', 'deleted_at',
    ]],
    'vehicle_specs' => ['vehicle_specs', [
        'vehicle_id', 'engine_code', 'engine_text', 'displacement_cc', 'fuel', 'aspiration', 'power_value', 'power_unit',
        'power_source', 'power_ps', 'torque_nm', 'torque_source', 'drivetrain', 'gearbox',
    ]],
    'modifications' => ['modifications', [
        'id', 'vehicle_id', 'category_id', 'title', 'brand_id', 'brand_text', 'part_name', 'part_number', 'status',
        'installed_on', 'cost_cents', 'cost_public', 'legal_status', 'notes', 'fields', 'sort', 'deleted_at',
    ]],
    'media' => ['media', [
        'id', 'owner_id', 'mediable_type', 'mediable_id', 'disk', 'original_path', 'variants', 'width', 'height', 'blurhash',
        'focal_x', 'focal_y', 'alt', 'category', 'sort', 'status', 'moderation_status', 'ai_tags', 'deleted_at',
    ]],
    'build_updates' => ['build_updates', ['id', 'vehicle_id', 'type', 'payload', 'note', 'hidden', 'created_at']],
    'qr_codes' => ['qr_codes', ['id', 'vehicle_id', 'code', 'status', 'revoked_at', 'revoked_reason']],
    'qr_scan_daily' => ['qr_scan_daily', ['qr_code_id', 'day', 'count']],
    'vehicle_search' => ['vehicle_search', [
        'vehicle_id', 'owner_id', 'make_id', 'model_id', 'generation_id', 'model_year', 'power_ps', 'drivetrain', 'gearbox',
        'fuel', 'wheel_diameter', 'wheel_brand_id', 'suspension_type', 'suspension_brand_id', 'exhaust_brand_id',
        'mod_category_mask', 'search_text', 'is_public', 'published_at', 'updated_at', 'rank_score',
    ]],
    'audit_events' => ['audit_events', [
        'id', 'occurred_at', 'actor_type', 'actor_id', 'action', 'target_type', 'target_id', 'before', 'after', 'reason',
        'request_id', 'prev_hash', 'hash',
    ]],
    'audit_event_access' => ['audit_event_access', ['audit_event_id', 'ip', 'user_agent', 'occurred_at']],
    'config_versions' => ['config_versions', ['key', 'version', 'status', 'payload', 'created_by', 'published_by', 'published_at', 'reason']],
    'feature_flags' => ['feature_flags', ['key', 'enabled', 'rules', 'description']],
    'legal_documents' => ['legal_documents', ['key', 'locale', 'version', 'body_md', 'published_at']],
    'idempotency_keys' => ['idempotency_keys', ['key', 'user_id', 'route', 'response_status', 'response_body', 'expires_at']],
]);

it('has a leading index for every foreign key', function () use ($tables) {
    $missing = [];

    foreach ($tables as $table) {
        $leading = array_map(fn (array $index) => $index['columns'][0], Schema::getIndexes($table));

        foreach (Schema::getForeignKeys($table) as $foreignKey) {
            if (! in_array($foreignKey['columns'][0], $leading, true)) {
                $missing[] = "$table.{$foreignKey['columns'][0]}";
            }
        }
    }

    expect($missing)->toBe([]);
});

it('has the indexes the data model names', function (string $table, array $columns) {
    $indexes = array_map(fn (array $index) => $index['columns'], Schema::getIndexes($table));

    expect($indexes)->toContain($columns);
})->with([
    [
        'vehicles', ['owner_id', 'status', 'visibility'],
    ],
    ['vehicle_search', ['make_id', 'model_id', 'generation_id']],
    ['vehicle_search', ['power_ps']],
    ['vehicle_search', ['model_year']],
    ['vehicle_search', ['rank_score']],
    ['vehicle_search', ['search_text']],
    ['vehicle_specs', ['power_ps']],
    ['qr_scan_daily', ['qr_code_id', 'day']],
    ['follows', ['follower_id', 'followee_id']],
    ['blocks', ['blocker_id', 'blocked_id']],
    ['saves', ['user_id', 'vehicle_id']],
]);

it('searches the projection with a FULLTEXT query', function () {
    $match = VehicleSearch::factory()->create(['search_text' => 'nissan skyline r34 gewindefahrwerk']);
    VehicleSearch::factory()->create(['search_text' => 'bmw m4 akrapovic']);

    // InnoDB FULLTEXT only sees committed rows, so leave the test transaction and clean up by hand.
    DB::commit();

    try {
        $found = VehicleSearch::query()->whereRaw('MATCH(search_text) AGAINST(? IN BOOLEAN MODE)', ['+skyline*'])->pluck('vehicle_id');

        expect($found->all())->toBe([$match->vehicle_id]);
    } finally {
        foreach (['vehicle_search', 'vehicles', 'generations', 'vehicle_models', 'makes', 'users'] as $table) {
            DB::table($table)->delete();
        }

        DB::beginTransaction();
    }
});

it('uses utf8mb4_unicode_ci, with a binary member address as the one exception (ADR-136)', function () {
    $collations = collect(Schema::getColumns('users'))->pluck('collation', 'name');

    expect($collations['username'])->toBe('utf8mb4_unicode_ci')
        ->and($collations['display_name'])->toBe('utf8mb4_unicode_ci')
        ->and($collations['email'])->toBe('utf8mb4_bin');
});

it('rejects a second account with the same email or username in any case', function () {
    User::factory()->create(['email' => 'Max@Speedclub.test', 'username' => 'Max.Muster']);

    expect(User::query()->where('email', 'max@speedclub.test')->where('username', 'max.muster')->exists())->toBeTrue();

    expect(fn () => User::factory()->create(['email' => 'MAX@speedclub.test']))->toThrow(UniqueConstraintViolationException::class);
    expect(fn () => User::factory()->create(['username' => 'MAX.MUSTER']))->toThrow(UniqueConstraintViolationException::class);
});

it('stores two-factor data encrypted', function () {
    $user = User::factory()->create();
    $user->forceFill(['two_factor_secret' => 'GEZDGNBVGY3TQOJQ', 'two_factor_recovery_codes' => ['aaaa-bbbb']])->save();

    $raw = DB::table('users')->where('id', $user->id)->first();

    expect($raw->two_factor_secret)->not->toContain('GEZDGNBVGY3TQOJQ')
        ->and($raw->two_factor_recovery_codes)->not->toContain('aaaa-bbbb')
        ->and($user->fresh()->two_factor_secret)->toBe('GEZDGNBVGY3TQOJQ')
        ->and($user->fresh()->two_factor_recovery_codes)->toBe(['aaaa-bbbb']);
});

it('does not let mass assignment set protected columns', function () {
    $user = new User(['status' => 'suspended', 'restrictions' => ['x'], 'email_verified_at' => now(), 'two_factor_secret' => 'x']);
    $vehicle = new Vehicle(['owner_id' => 'x', 'public_id' => 'x', 'status' => 'published', 'is_main' => true]);
    $spec = new VehicleSpec(['power_ps' => 1]);

    expect($user->getAttributes())->toBe([])
        ->and($vehicle->getAttributes())->toBe([])
        ->and($spec->getAttributes())->toBe([]);
});

it('hides secrets from serialisation', function () {
    $user = User::factory()->create()->forceFill(['two_factor_secret' => 'x']);

    expect($user->toArray())->not->toHaveKeys(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'])
        ->and(VerificationCode::factory()->create()->toArray())->not->toHaveKey('code_hash')
        ->and(Media::factory()->create()->toArray())->not->toHaveKey('original_path');
});

it('keeps the entered power untouched and power_ps normalised', function () {
    $spec = VehicleSpec::factory()->create()->setPower(375, PowerUnit::Kw);
    $spec->save();
    $spec->refresh();

    expect($spec->power_value)->toBe(375.0)
        ->and($spec->power_unit)->toBe(PowerUnit::Kw)
        ->and($spec->power_ps)->toBe(Units::toPs(375, PowerUnit::Kw))
        ->and($spec->power_ps)->toBe(509.86);
});

it('clears all power columns together', function () {
    $spec = VehicleSpec::factory()->create()->setPower(null, PowerUnit::Kw);
    $spec->save();
    $spec->refresh();

    expect($spec->power_value)->toBeNull()
        ->and($spec->power_unit)->toBeNull()
        ->and($spec->power_ps)->toBeNull();
});

it('rejects changes to audit events in the model', function () {
    $event = AuditEvent::factory()->create();

    expect(fn () => $event->update(['action' => 'tampered']))->toThrow(LogicException::class)
        ->and(fn () => $event->delete())->toThrow(LogicException::class);
});

it('rejects changes to audit events in the database', function () {
    $event = AuditEvent::factory()->create();

    expect(fn () => DB::table('audit_events')->where('id', $event->id)->update(['action' => 'tampered']))->toThrow(QueryException::class)
        ->and(fn () => DB::table('audit_events')->where('id', $event->id)->delete())->toThrow(QueryException::class);
});

it('has a factory that creates each model', function (string $model) {
    expect($model::factory()->create()->exists)->toBeTrue();
})->with([
    User::class, PersonalAccessToken::class, VerificationCode::class, PushToken::class, Follow::class, Block::class, Save::class,
    Make::class, VehicleModel::class, Generation::class, Brand::class, ModCategory::class, ModCategoryField::class,
    CatalogRequest::class, Vehicle::class, VehicleSpec::class, Modification::class, Media::class, BuildUpdate::class,
    QrCode::class, QrScanDaily::class, VehicleSearch::class, AuditEvent::class, ConfigVersion::class, FeatureFlag::class,
    LegalDocument::class, IdempotencyKey::class, DiscoverCollection::class, CatalogImport::class, ModCategorySchemaVersion::class,
    BrandAsset::class, MessageTemplate::class, Release::class,
]);

it('uses ULID keys for user content', function (string $model) {
    expect($model::factory()->create()->getKey())->toMatch('/\A[0-9a-hjkmnp-tv-z]{26}\z/');
})->with([User::class, Vehicle::class, Modification::class, Media::class, BuildUpdate::class, QrCode::class, CatalogRequest::class, PushToken::class, VerificationCode::class]);

it('registers a policy and a morph name for every model', function () {
    $root = dirname(__DIR__, 3);
    $adminModels = ['App\Models\Staff', 'App\Models\Role', 'App\Models\Permission', 'App\Models\ApprovalRequest', 'App\Models\CatalogImport', 'App\Models\ModCategorySchemaVersion', 'App\Models\BrandAsset', 'App\Models\MessageTemplate', 'App\Models\Release', 'App\Models\KeywordRule', 'App\Models\KeywordRuleHit', 'App\Models\SorTemplate', 'App\Models\SupportMacro', 'App\Models\StaffInvitation', 'App\Models\PrivacyRequest', 'App\Models\MembershipPlan', 'App\Models\Entitlement']; // Staff policies come with the admin modules.

    $classes = SourceScanner::classesIn("$root/app", ["$root/app/Models"]);
    expect(count($classes))->toBeGreaterThan(25);

    foreach ($classes as $class) {
        expect(Relation::getMorphAlias($class))->not->toBe($class, "$class has no morph name");

        if (! in_array($class, $adminModels, true)) {
            expect(Gate::getPolicyFor($class))->not->toBeNull("$class has no policy");
        }
    }
});
