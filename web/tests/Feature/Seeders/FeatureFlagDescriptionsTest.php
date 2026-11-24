<?php

use App\Enums\AuditActorType;
use App\Models\AuditEvent;
use Illuminate\Support\Facades\DB;

/**
 * Crawl triage (M5.9f): every flag of database/data/feature_flags.json has a description for ADM-36, `sticker_shop` names no config key,
 * and the migration 2026_12_22_100100 fills empty descriptions and rewords the old seeded sticker_shop text on existing hosts, never
 * staff's own text; audited by the system, idempotent.
 */
function ffdMigration(): object
{
    return require database_path('migrations/2026_12_22_100100_refresh_feature_flag_descriptions.php');
}

/** @return array<string, string> */
function ffdTexts(): array
{
    return json_decode((string) file_get_contents(database_path('data/feature_flags.json')), true, flags: JSON_THROW_ON_ERROR);
}

function ffdFlag(string $key, ?string $description, bool $enabled = true): void
{
    DB::table('feature_flags')->insert(['key' => $key, 'enabled' => $enabled, 'rules' => null, 'description' => $description, 'created_at' => now(), 'updated_at' => now()]);
}

it('describes every flag in the data file, and the sticker shop without a config key', function () {
    foreach (ffdTexts() as $key => $text) {
        expect(trim($text))->not->toBe('', "flag $key has no description");
    }

    expect(ffdTexts()['sticker_shop'])->toContain('Sticker bestellen')
        ->and(ffdTexts()['sticker_shop'])->not->toMatch('/links\.|sticker_shop|Remote-Config/');
});

it('fills empty descriptions and rewords the old sticker_shop text, never staff\'s own text', function () {
    $migration = ffdMigration();
    ffdFlag('sticker_shop', $migration::OLD['sticker_shop'], false);
    ffdFlag('build_reactions', null);
    ffdFlag('mentions', '  ');
    ffdFlag('collections', 'Eigener Text vom Team');
    ffdFlag('events', ffdTexts()['events']);
    ffdFlag('nicht.in.der.datei', null);

    expect(collect($migration->refresh())->sort()->values()->all())->toBe(['build_reactions', 'mentions', 'sticker_shop'])
        ->and(DB::table('feature_flags')->pluck('description', 'key')->all())->toMatchArray([
            'sticker_shop' => ffdTexts()['sticker_shop'],
            'build_reactions' => ffdTexts()['build_reactions'],
            'mentions' => ffdTexts()['mentions'],
            'collections' => 'Eigener Text vom Team',
            'events' => ffdTexts()['events'],
            'nicht.in.der.datei' => null,
        ]);

    $events = AuditEvent::query()->where('action', 'flag.changed')->get();
    expect($events)->toHaveCount(3)
        ->and($events->every(fn (AuditEvent $e): bool => $e->getRawOriginal('actor_type') === AuditActorType::System->value && $e->actor_id === null))->toBeTrue()
        ->and($events->firstWhere('after.key', 'sticker_shop')?->before['description'])->toBe($migration::OLD['sticker_shop']);

    // Idempotent: a second run changes and records nothing.
    expect(ffdMigration()->refresh())->toBe([])
        ->and(AuditEvent::query()->where('action', 'flag.changed')->count())->toBe(3);
});

it('changes nothing on a host without flags (a fresh install gets the texts from the seeder)', function () {
    expect(ffdMigration()->refresh())->toBe([])
        ->and(AuditEvent::query()->count())->toBe(0);
});
