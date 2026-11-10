<?php

use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\ModerationStatus;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoSeeder;
use Database\Seeders\ModerationDemoSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/**
 * M2.6 demo data (m2.6-contract §4): a decided photo case of tobi.quattro (SAFE-01, SET-16 decisions), reported by nico.sti, and an open
 * report by lukas.sc (SET-16 "Meine Meldungen"), all through the Actions; lukas.sc's notification history is unchanged.
 * M3.4 adds the admin queue of other demo members (ModerationDemoSeeder::seedAdminQueue, tests/Feature/Admin/M34/DemoQueueTest.php);
 * the checks here cover the M2.6 rows, which stay exactly as they were.
 */
function modDemoSeed(bool $photos): void
{
    Mail::fake();
    Storage::fake('public');
    Storage::fake('local');
    config([
        'speedclub.media.disk' => 'public',
        'speedclub.media.private_disk' => 'local',
        'queue.default' => 'sync',
        'speedclub.demo.member_password' => 'demo-member-password',
        'speedclub.demo.photo_limit' => $photos ? 99 : 0,
    ]);

    // Only the RS6 gallery exists here, so every other photo is skipped as missing.
    $directory = sys_get_temp_dir().'/speedclub-seed-'.uniqid();
    mkdir($directory);
    $entries = [];

    foreach (['audi-rs6-c8-01.jpg', 'generic-wheels-04.jpg'] as $file) {
        file_put_contents($directory.'/'.$file, UploadedFile::fake()->image($file, 400, 300)->getContent());
        $entries[] = ['file' => $file, 'alt_de' => 'Manifest', 'category' => 'exterior', 'focal' => ['x' => 0.5, 'y' => 0.5]];
    }

    file_put_contents($directory.'/manifest.json', json_encode($entries));

    $seeder = new class($directory) extends DemoSeeder
    {
        public function __construct(private readonly string $directory) {}

        protected function photoDirectory(): string
        {
            return $this->directory;
        }
    };

    $seeder->setContainer(app())->__invoke();

    array_map(unlink(...), glob($directory.'/*') ?: []);
    rmdir($directory);
}

it('seeds a decided photo case for tobi.quattro and an open report by lukas.sc', function () {
    modDemoSeed(photos: true);

    $tobi = User::query()->where('username', 'tobi.quattro')->firstOrFail();
    $nico = User::query()->where('username', 'nico.sti')->firstOrFail();
    $lukas = User::query()->where('username', 'lukas.sc')->firstOrFail();
    $rs6 = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('audi-rs6-c8'))->firstOrFail();
    $decision = Decision::query()->where('subject_id', $tobi->id)->sole();
    $photo = Media::query()->findOrFail(ModerationCase::query()->findOrFail($decision->case_id)->target_id);

    expect($decision->action)->toBe(DecisionAction::RemoveContent)
        // A fixed id, as DemoSeeder's conversations have, so e2e can address /app/decisions/{id} (M2.8 fix round).
        ->and($decision->id)->toBe(ModerationDemoSeeder::decisionId(CarbonImmutable::parse(DemoSeeder::NOW)))
        ->and($decision->id)->toBe(strtolower($decision->id))
        ->and(Str::isUlid($decision->id))->toBeTrue()
        ->and($decision->decided_at?->equalTo(CarbonImmutable::parse(DemoSeeder::NOW)->subDays(7)->setTime(10, 15)))->toBeTrue()
        // Only that one id is fixed: the next ULID is random again.
        ->and(Str::ulid()->toBase32())->not->toBe(strtoupper($decision->id))
        ->and($decision->subject_id)->toBe($tobi->id)
        ->and($decision->facts())->not->toBe('')
        // The paragraph sign keeps its number on SAFE-01 (DQ-429), as the seeded legal texts do (DQ-221).
        ->and($decision->ground())->toStartWith("Community-Richtlinien \u{00A7}\u{00A0}4 (Deine Inhalte)")
        ->and($photo->moderation_status)->toBe(ModerationStatus::Rejected)
        ->and($rs6->refresh()->cover_media_id)->not->toBe($photo->id)
        ->and($rs6->cover_media_id)->not->toBeNull()
        ->and(Report::query()->where('reporter_id', $nico->id)->sole()->target_type)->toBe(ReportTargetType::Photo);

    $open = Report::query()->where('reporter_id', $lukas->id)->sole();
    expect(ModerationCase::query()->findOrFail($open->case_id)->status)->toBe(CaseStatus::New)
        ->and(Notification::query()->where('notifiable_id', $lukas->id)->whereIn('type', [NotificationType::ModerationDecision->value, NotificationType::ReportDecided->value])->exists())->toBeFalse()
        ->and(Notification::query()->where('notifiable_id', $tobi->id)->where('type', NotificationType::ModerationDecision->value)->count())->toBe(1);

    Sanctum::actingAs($tobi);
    $this->getJson("/api/v1/decisions/{$decision->id}")->assertOk()->assertJsonPath('data.viewer', 'affected');
    $this->getJson('/api/v1/me/decisions')->assertOk()->assertJsonCount(1, 'data');
    Sanctum::actingAs($lukas);
    $this->getJson('/api/v1/me/reports')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.status', 'received');
});

it('seeds the open report alone when there are no demo photos', function () {
    modDemoSeed(photos: false);

    $m26 = User::query()->whereIn('username', ['tobi.quattro', 'nico.sti', 'lukas.sc'])->pluck('id');

    expect(Decision::query()->whereIn('subject_id', $m26)->count())->toBe(0)
        ->and(Report::query()->whereIn('reporter_id', $m26)->count())->toBe(1)
        ->and(Report::query()->whereIn('reporter_id', $m26)->sole()->reporter?->username)->toBe('lukas.sc');
});
