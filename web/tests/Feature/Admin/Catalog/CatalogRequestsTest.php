<?php

use App\Actions\Admin\Catalog\AcceptCatalogRequest;
use App\Actions\Admin\Catalog\RejectCatalogRequest;
use App\Enums\CatalogRequestStatus;
use App\Enums\NotificationType;
use App\Models\CatalogRequest;
use App\Models\Make;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogRefused;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CatalogHelpers.php';

/**
 * M3.3 ADM-14 Anfragen: Übernehmen (create or pick the entry, relink the requester's vehicle, notify in-app) and Ablehnen (reason,
 * notify).
 */
beforeEach(function () {
    seedModSchema();
    $this->staff = m33cEditor();
    $this->member = User::factory()->create(['username' => 'jonas.mf5', 'locale' => 'de']);
    $this->vehicle = publishedVehicle($this->member, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Wiesmann', 'model_text' => 'MF5']);
    app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);
    $this->request = CatalogRequest::factory()->create(['user_id' => $this->member->id, 'vehicle_id' => $this->vehicle->id, 'make_text' => 'Wiesmann', 'model_text' => 'MF5', 'generation_text' => null]);
});

it('creates the entries, relinks the vehicle and tells the member', function () {
    $resolved = app(AcceptCatalogRequest::class)->handle($this->staff, $this->request, ['make_name' => 'Wiesmann', 'country' => 'DE', 'model_name' => 'MF5', 'generation_name' => 'Roadster', 'year_from' => 2009]);

    $make = Make::query()->where('slug', 'wiesmann')->firstOrFail();
    $model = VehicleModel::query()->where('make_id', $make->id)->where('slug', 'mf5')->firstOrFail();
    $vehicle = $this->vehicle->refresh();

    expect($resolved->status)->toBe(CatalogRequestStatus::Approved)->and($resolved->resolved_by)->toBe($this->staff->id);
    expect($vehicle->make_id)->toBe($make->id)->and($vehicle->model_id)->toBe($model->id)->and($vehicle->make_text)->toBeNull()->and($vehicle->model_text)->toBeNull();
    expect($vehicle->generation_id)->not->toBeNull()->and($vehicle->slug)->toStartWith('wiesmann-mf5-roadster-');
    expect(DB::table('vehicle_search')->where('vehicle_id', $vehicle->id)->value('make_id'))->toBe($make->id);
    expect(m33cEvents('catalog.created'))->toHaveCount(3)->and(m33cEvents('catalog.request_accepted')[0]->after)->toMatchArray(['vehicle_relinked' => true]);

    $row = Notification::query()->where('notifiable_id', $this->member->id)->where('type', NotificationType::CatalogRequest)->sole();
    expect($row->data)->toMatchArray(['outcome' => 'accepted', 'requested' => 'Wiesmann MF5', 'reason' => null])->and($row->vehicle_id)->toBe($vehicle->id);

    Sanctum::actingAs($this->member);
    $this->getJson('/api/v1/notifications')->assertOk()
        ->assertJsonPath('data.0.type', 'catalog_request')
        ->assertJsonPath('data.0.details.outcome', 'accepted')
        ->assertJsonPath('data.0.vehicle.id', $vehicle->id);
});

it('picks an existing entry, also through a merged alias, instead of a duplicate', function () {
    $survivor = Make::factory()->create(['name' => 'Wiesmann', 'slug' => 'wiesmann-gmbh']);
    Make::factory()->create(['name' => 'Wiesmann', 'slug' => 'wiesmann', 'merged_into_id' => $survivor->id, 'active' => false]);

    app(AcceptCatalogRequest::class)->handle($this->staff, $this->request, ['make_name' => 'Wiesmann', 'model_name' => 'MF5']);

    expect($this->vehicle->refresh()->make_id)->toBe($survivor->id)->and(Make::query()->count())->toBe(2);
});

it('keeps a catalogue choice the member made since', function () {
    $own = VehicleModel::factory()->create();
    Vehicle::query()->whereKey($this->vehicle->id)->update(['make_id' => $own->make_id, 'model_id' => $own->id, 'make_text' => null, 'model_text' => null]);

    app(AcceptCatalogRequest::class)->handle($this->staff, $this->request, ['make_name' => 'Wiesmann', 'model_name' => 'MF5']);

    expect($this->vehicle->refresh()->model_id)->toBe($own->id)->and(m33cEvents('catalog.request_accepted')[0]->after['vehicle_relinked'])->toBeFalse();
});

it('rejects with a reason and tells the member', function () {
    app(RejectCatalogRequest::class)->handle($this->staff, $this->request, 'Kein Serienfahrzeug, bitte als Sonstiges eintragen.');

    expect($this->request->refresh()->status)->toBe(CatalogRequestStatus::Rejected)->and($this->request->rejection_reason)->toBe('Kein Serienfahrzeug, bitte als Sonstiges eintragen.');
    expect($this->vehicle->refresh()->make_text)->toBe('Wiesmann');
    $row = Notification::query()->where('notifiable_id', $this->member->id)->where('type', NotificationType::CatalogRequest)->sole();
    expect($row->data)->toMatchArray(['outcome' => 'rejected', 'reason' => 'Kein Serienfahrzeug, bitte als Sonstiges eintragen.']);
    expect(fn () => app(RejectCatalogRequest::class)->handle($this->staff, $this->request, 'Zu kurz'))->toThrow(ValidationException::class);
});

it('decides a request once', function () {
    app(RejectCatalogRequest::class)->handle($this->staff, $this->request, m33cReason());

    expect(fn () => app(AcceptCatalogRequest::class)->handle($this->staff, $this->request, ['make_name' => 'Wiesmann']))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('request_resolved'));
    expect(Notification::query()->where('type', NotificationType::CatalogRequest)->count())->toBe(1);
});

it('lets only the roles with catalog.manage decide', function (string $role, bool $allowed) {
    $run = fn () => app(RejectCatalogRequest::class)->handle(m31Staff($role), $this->request, m33cReason());

    $allowed ? expect($run()->status)->toBe(CatalogRequestStatus::Rejected) : expect($run)->toThrow(AuthorizationException::class);
})->with(m33cMatrix());

it('needs a make', function () {
    expect(fn () => app(AcceptCatalogRequest::class)->handle($this->staff, $this->request, ['model_name' => 'MF5']))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('make_id'));
});
