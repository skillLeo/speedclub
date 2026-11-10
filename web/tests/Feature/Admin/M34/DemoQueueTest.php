<?php

use App\Enums\AppealStatus;
use App\Enums\CaseStatus;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Models\Appeal;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoSeeder;
use Database\Seeders\ModerationDemoSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/Helpers.php';

/**
 * M3.4 demo queue (ModerationDemoSeeder::seedAdminQueue): every ADM-20…27 screen has deterministic content, through the real Actions, and
 * none of it touches a member of a flagship screen. Seeding twice adds nothing.
 */
/** DemoSeeder without demo photos (as ModerationDemoTest's modDemoSeed). */
function adm34DemoSeed(bool $photos): void
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

it('seeds the moderation and support queues for the admin screens', function () {
    adm34DemoSeed(photos: false);

    $marco = User::query()->where('username', 'marco.amg')->firstOrFail();
    $message = ModerationCase::query()->where('target_type', ReportTargetType::Message->value)->sole();
    expect($message->status)->toBe(CaseStatus::New)
        ->and($message->subject_id)->toBe($marco->id)
        ->and(Report::query()->where('case_id', $message->id)->sole()->evidence['messages'] ?? [])->toHaveCount(4)
        ->and(Appeal::query()->sole()->status)->toBe(AppealStatus::Open)
        ->and(ModerationCase::query()->where('automated', true)->count())->toBe(1)
        ->and(Report::query()->where('source', ReportSource::WebForm->value)->count())->toBe(1)
        ->and(KeywordRule::query()->count())->toBe(3)
        ->and(SupportTicket::query()->count())->toBe(4);

    // The flagship members keep their M2.6 state.
    $flagship = User::query()->whereIn('username', ['lukas.sc', 'tobi.quattro', 'nico.sti', 'jann.ptrs'])->pluck('id');
    expect(Report::query()->whereIn('reporter_id', $flagship)->count())->toBe(1)
        ->and(ModerationCase::query()->whereIn('subject_id', $flagship)->count())->toBe(1);

    (new ModerationDemoSeeder)->seedAdminQueue(CarbonImmutable::parse(DemoSeeder::NOW));
    expect(KeywordRule::query()->count())->toBe(3)->and(SupportTicket::query()->count())->toBe(4)->and(TicketMessage::query()->where('internal', true)->count())->toBeLessThanOrEqual(1);
});

it('gives every seeded moderation case and support ticket a fixed id, so ADM-20 and ADM-25 print the same numbers after every seed (DQ-698, DQ-701)', function () {
    adm34DemoSeed(photos: true);

    $now = CarbonImmutable::parse(DemoSeeder::NOW);
    $seeds = ['rs6-photo-case', 'yaris-case', 'message-case', 'appeal-case', 'web-case', 'flag-case', 'spam-case:vw-scirocco', 'spam-case:mercedes-w177'];
    $fixed = collect($seeds)->map(fn (string $seed): string => strtolower(ModerationDemoSeeder::fixedId($seed, $now)))->sort()->values()->all();

    expect(ModerationCase::query()->pluck('id')->map(fn (mixed $id): string => strtolower((string) $id))->sort()->values()->all())->toBe($fixed);

    // ADM-25 prints the ticket references the same way (DQ-701).
    $tickets = collect(['member-ticket', 'guest-ticket', 'guest-ticket:mira', 'member-ticket:paul'])->map(fn (string $seed): string => strtolower(ModerationDemoSeeder::fixedId($seed, $now)))->sort()->values()->all();
    expect(SupportTicket::query()->pluck('id')->map(fn (mixed $id): string => strtolower((string) $id))->sort()->values()->all())->toBe($tickets);
});
