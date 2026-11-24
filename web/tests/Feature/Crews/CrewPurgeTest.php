<?php

use App\Enums\CaseStatus;
use App\Models\Crew;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CrewTestHelpers.php';

/**
 * R4-2.3 (contract-crews.md §7): a crew its founder deleted keeps logo and cover (private originals) while soft-deleted; crews:prune
 * removes row and media after hard_delete_after_days, never while a moderation case about the crew is open (DSA evidence).
 */
beforeEach(function () {
    crewFlags();
    Storage::fake(config()->string('speedclub.media.disk'));
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

it('keeps logo and cover of a deleted crew while a case is open and purges them once it is decided', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    Sanctum::actingAs($founder);
    $this->post("/api/v1/crews/{$crew->slug}/logo", ['file' => UploadedFile::fake()->image('logo.jpg', 512, 512)], ['Accept' => 'application/json'])->assertCreated();
    $logo = Media::query()->findOrFail($crew->refresh()->logo_media_id);
    $original = (string) $logo->getAttribute('original_path');
    expect(Storage::disk(config()->string('speedclub.media.private_disk'))->exists($original))->toBeTrue();

    Sanctum::actingAs(User::factory()->create());
    $this->postJson('/api/v1/reports', ['target_type' => 'crew', 'target_id' => $crew->id, 'reason' => 'harassment'])->assertCreated();

    Sanctum::actingAs($founder);
    $this->deleteJson("/api/v1/crews/{$crew->slug}", ['confirm_name' => $crew->name])->assertNoContent();

    // Withdrawn from the public disk at once, the private original and the row stay.
    $logo->refresh();
    expect($logo->getAttribute('variants'))->toBeNull()
        ->and(Storage::disk(config()->string('speedclub.media.private_disk'))->exists($original))->toBeTrue()
        ->and(Crew::withTrashed()->find($crew->id)?->logo_media_id)->toBe($logo->id);

    $this->travel(config()->integer('speedclub.crews.hard_delete_after_days') + 1)->days();
    $this->artisan('crews:prune')->assertSuccessful();
    expect(Crew::withTrashed()->find($crew->id))->not->toBeNull()
        ->and(Media::withTrashed()->find($logo->id))->not->toBeNull()
        ->and(Storage::disk(config()->string('speedclub.media.private_disk'))->exists($original))->toBeTrue();

    // The case is decided: nothing holds the crew any more.
    ModerationCase::query()->where('target_type', 'crew')->update(['open_target' => null, 'status' => CaseStatus::Closed->value]);
    $this->artisan('crews:prune')->assertSuccessful();
    expect(Crew::withTrashed()->find($crew->id))->toBeNull()
        ->and(Media::withTrashed()->find($logo->id))->toBeNull()
        ->and(Storage::disk(config()->string('speedclub.media.private_disk'))->exists($original))->toBeFalse();
});

it('waits for the retention before purging a deleted crew, and never touches a live one', function () {
    $founder = User::factory()->create();
    $deleted = crewMake($founder);
    $live = crewMake();
    Sanctum::actingAs($founder);
    $this->deleteJson("/api/v1/crews/{$deleted->slug}", ['confirm_name' => $deleted->name])->assertNoContent();

    $this->artisan('crews:prune')->assertSuccessful();
    expect(Crew::withTrashed()->find($deleted->id))->not->toBeNull();

    $this->travel(config()->integer('speedclub.crews.hard_delete_after_days') + 1)->days();
    $this->artisan('crews:prune')->assertSuccessful();
    expect(Crew::withTrashed()->find($deleted->id))->toBeNull()->and($live->fresh())->not->toBeNull();
});
