<?php

use App\Enums\MediaStatus;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Services\BuildScore\BuildScores;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/BuildScoreTestHelpers.php';

/**
 * M5.9c Build Journey (m5.9c contract §2, ADR-436 d): a before/after update is created first; its two photos follow through
 * build-updates/{id}/media (before, then after) and are paired when the second arrives or by PATCH photo_pairs. The pair counts for the
 * Build Score once both photos are ready.
 */
beforeEach(function () {
    bsFlags(['build_reactions' => true]);
    seedModSchema();
    $this->owner = User::factory()->create();
    $this->car = bsCar($this->owner);
    $this->mod = bsMod($this->car, photo: false);
});

function bsUpload(BuildUpdate $update, string $name = 'a.jpg')
{
    return test()->post("/api/v1/build-updates/{$update->id}/media", ['file' => UploadedFile::fake()->createWithContent($name, TestImages::jpeg(400, 300))], ['Accept' => 'application/json']);
}

it('posts a before/after with its mod, as modification_id or as the one modification_ids entry', function (string $as) {
    Sanctum::actingAs($this->owner);
    $body = match ($as) {
        'id' => ['modification_id' => $this->mod->id],
        'both' => ['modification_id' => $this->mod->id, 'modification_ids' => [$this->mod->id]],
        default => ['modification_ids' => [$this->mod->id]],
    };

    $data = $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->car->id, 'kind' => 'before_after', 'text' => 'Vorher/Nachher Fahrwerk', ...$body])
        ->assertCreated()->json('data');

    expect($data['kind'])->toBe('before_after')
        ->and(array_column($data['modifications'], 'id'))->toBe([$this->mod->id])
        ->and(BuildUpdate::query()->find($data['id'])?->kind->value)->toBe('before_after');
})->with([
    'modification_id' => ['id'],
    'both, as the app sends them' => ['both'],
    'modification_ids only' => ['ids'],
]);

it('keeps a plain post a post', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->car->id, 'text' => 'Waschtag'])->assertCreated()->assertJsonPath('data.kind', 'post');
});

it('refuses a mod of another car, two mods, a mod without the kind and an unknown kind', function (Closure $body, string $field) {
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->car->id, ...$body($this->mod, $this->car)])
        ->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'foreign mod' => [fn ($mod, $car) => ['kind' => 'before_after', 'modification_id' => bsMod(bsCar())->id], 'modification_id'],
    'two mods' => [fn ($mod, $car) => ['kind' => 'before_after', 'modification_ids' => [$mod->id, bsMod($car)->id]], 'modification_ids'],
    'modification_id on a post' => [fn ($mod, $car) => ['modification_id' => $mod->id], 'modification_id'],
    'unknown kind' => [fn ($mod, $car) => ['kind' => 'slider'], 'kind'],
]);

it('takes exactly two photos, pairs them in upload order when the second arrives, and refuses a third', function () {
    Storage::fake('public');
    Storage::fake('local');
    Sanctum::actingAs($this->owner);
    $id = $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->car->id, 'kind' => 'before_after'])->assertCreated()->json('data.id');
    $update = BuildUpdate::query()->findOrFail($id);

    $before = bsUpload($update, 'before.jpg')->assertCreated()->json('data.id');
    expect($update->refresh()->photo_pairs)->toBeNull();

    $after = bsUpload($update, 'after.jpg')->assertCreated()->json('data.id');
    expect($update->refresh()->photo_pairs)->toBe([[$before, $after]]);

    bsUpload($update, 'third.jpg')->assertUnprocessable()->assertJsonValidationErrors('file');

    $this->getJson("/api/v1/build-updates/{$id}")->assertOk()
        ->assertJsonPath('data.kind', 'before_after')
        ->assertJsonPath('data.photo_pairs', [['before' => $before, 'after' => $after]]);
});

it('lets the owner swap the pair but never hold two pairs or two mods', function () {
    $update = bsPair($this->car);
    [$before, $after] = $update->photo_pairs[0];
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/build-updates/{$update->id}", ['photo_pairs' => [[$after, $before]]])->assertOk()
        ->assertJsonPath('data.photo_pairs', [['before' => $after, 'after' => $before]]);
    $this->patchJson("/api/v1/build-updates/{$update->id}", ['photo_pairs' => [[$after, $before], [$before, $after]]])
        ->assertUnprocessable()->assertJsonValidationErrors('photo_pairs');
    $this->patchJson("/api/v1/build-updates/{$update->id}", ['modification_ids' => [$this->mod->id, bsMod($this->car)->id]])
        ->assertUnprocessable()->assertJsonValidationErrors('modification_ids');
});

it('counts the pair for the Build Score only once both photos are ready', function () {
    $update = bsPair($this->car, ['status' => MediaStatus::Processing]);
    $scores = app(BuildScores::class);
    $without = $scores->recompute($this->car->id)?->breakdown['before_after'];

    Media::query()->where('mediable_id', $update->id)->update(['status' => MediaStatus::Ready->value]);
    $with = $scores->recompute($this->car->id)?->breakdown['before_after'];

    expect($without)->toBe(['points' => 0, 'max' => 45, 'have' => 0])
        ->and($with)->toBe(['points' => 15, 'max' => 45, 'have' => 1]);
});

it('is the owner\'s only', function () {
    $update = bsPost($this->car, ['kind' => 'before_after']);
    Sanctum::actingAs(User::factory()->create());

    bsUpload($update)->assertForbidden();
    $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->car->id, 'kind' => 'before_after'])->assertForbidden();
});
