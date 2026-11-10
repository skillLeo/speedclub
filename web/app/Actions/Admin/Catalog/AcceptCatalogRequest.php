<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogLevel;
use App\Enums\CatalogRequestStatus;
use App\Jobs\Catalog\RelinkCatalogVehicles;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\CatalogSlugs;
use App\Services\Catalog\Reason;
use App\Services\Notifications\Notifier;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Slug;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 Anfragen "Übernehmen" (`catalog.manage`): pick an entry per level or create it ({make_id | make_name, country?}, {model_id |
 * model_name}?, {generation_id | generation_name, year_from?, year_to?}?; a name that already resolves, merged aliases included, picks
 * that entry instead of a duplicate), then relink the requester's vehicle while it still carries the free text (make_text / model_text
 * cleared, slug and search row follow), mark the request approved and tell the member in-app ("Dein Fahrzeug ist jetzt im Katalog").
 * New entries are audited by CreateCatalogEntry; the request as `catalog.request_accepted`.
 */
class AcceptCatalogRequest
{
    public function __construct(
        private readonly CreateCatalogEntry $create,
        private readonly Notifier $notifier,
        private readonly VehicleSearchProjector $search,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, CatalogRequest $request, array $input, ?string $reason = null): CatalogRequest
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::optional($reason);
        $valid = Validator::make($input, [
            'make_id' => ['nullable', 'integer', Rule::exists(Make::class, 'id'), 'required_without:make_name'],
            'make_name' => ['nullable', 'string', 'max:100', 'prohibits:make_id'],
            'country' => ['nullable', 'string', 'regex:/^[A-Za-z]{2}$/'],
            'model_id' => ['nullable', 'integer', Rule::exists(VehicleModel::class, 'id'), 'prohibits:model_name'],
            'model_name' => ['nullable', 'string', 'max:100'],
            'generation_id' => ['nullable', 'integer', Rule::exists(Generation::class, 'id'), 'prohibits:generation_name'],
            'generation_name' => ['nullable', 'string', 'max:100', 'required_with:year_from,year_to'],
            'year_from' => ['nullable', 'integer'],
            'year_to' => ['nullable', 'integer'],
        ])->validate();

        $notify = DB::transaction(function () use ($staff, $request, $valid, $reason): array {
            /** @var CatalogRequest $locked */
            $locked = CatalogRequest::query()->whereKey($request->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status !== CatalogRequestStatus::Pending) {
                throw new CatalogRefused('request_resolved');
            }

            $make = $this->make($staff, $valid, $reason);
            $model = $this->model($staff, $make, $valid, $reason);
            $generation = $model === null ? null : $this->generation($staff, $model, $valid, $reason);

            if ($model !== null && (int) $model->getAttribute('make_id') !== (int) $make->getKey()) {
                $make = Make::query()->findOrFail((int) $model->getAttribute('make_id'));
            }

            if ($generation !== null && (int) $generation->getAttribute('model_id') !== (int) $model->getKey()) {
                throw ValidationException::withMessages(['generation_id' => [(string) __('validation.exists', ['attribute' => 'generation'])]]);
            }

            $relinked = $this->relink($locked, $make, $model, $generation);

            $locked->forceFill([
                'status' => CatalogRequestStatus::Approved,
                'resolved_by' => $staff->getKey(),
                'resolved_at' => now(),
            ])->save();

            Audit::record(CatalogEvent::RequestAccepted->value, $locked, after: [
                'make_id' => $make->getKey(),
                'model_id' => $model?->getKey(),
                'generation_id' => $generation?->getKey(),
                'vehicle_relinked' => $relinked,
            ], reason: $reason, actor: $staff);

            return [$locked, $locked->user_id];
        });

        [$resolved, $userId] = $notify;
        $user = is_string($userId) ? User::query()->find($userId) : null;

        if ($user instanceof User) {
            $this->notifier->catalogRequest($user, $resolved, accepted: true);
        }

        return $resolved;
    }

    /**
     * @param  array<string, mixed>  $valid
     */
    private function make(Staff $staff, array $valid, ?string $reason): Make
    {
        if (isset($valid['make_id'])) {
            return CatalogSlugs::survivor(Make::query()->findOrFail((int) $valid['make_id']));
        }

        $name = trim((string) $valid['make_name']);
        $existing = CatalogSlugs::make(Slug::make($name));

        if ($existing !== null) {
            return $existing;
        }

        /** @var Make $make */
        $make = $this->create->handle($staff, CatalogLevel::Make, array_filter(['name' => $name, 'country' => $valid['country'] ?? null], fn ($v) => $v !== null), $reason);

        return $make;
    }

    /**
     * @param  array<string, mixed>  $valid
     */
    private function model(Staff $staff, Make $make, array $valid, ?string $reason): ?VehicleModel
    {
        if (isset($valid['model_id'])) {
            return CatalogSlugs::survivor(VehicleModel::query()->findOrFail((int) $valid['model_id']));
        }

        $name = trim((string) ($valid['model_name'] ?? ''));

        if ($name === '') {
            return null;
        }

        $existing = CatalogSlugs::model($make, Slug::make($name));

        if ($existing !== null) {
            return $existing;
        }

        /** @var VehicleModel $model */
        $model = $this->create->handle($staff, CatalogLevel::Model, ['make_id' => $make->getKey(), 'name' => $name], $reason);

        return $model;
    }

    /**
     * @param  array<string, mixed>  $valid
     */
    private function generation(Staff $staff, VehicleModel $model, array $valid, ?string $reason): ?Generation
    {
        if (isset($valid['generation_id'])) {
            return CatalogSlugs::survivor(Generation::query()->findOrFail((int) $valid['generation_id']));
        }

        $name = trim((string) ($valid['generation_name'] ?? ''));

        if ($name === '') {
            return null;
        }

        $existing = CatalogSlugs::generation($model, Slug::make($name));

        if ($existing !== null) {
            return $existing;
        }

        /** @var Generation $generation */
        $generation = $this->create->handle($staff, CatalogLevel::Generation, array_filter([
            'model_id' => $model->getKey(),
            'name' => $name,
            'year_from' => $valid['year_from'] ?? null,
            'year_to' => $valid['year_to'] ?? null,
        ], fn ($v) => $v !== null), $reason);

        return $generation;
    }

    /**
     * The requester's vehicle takes the entries while it still names the car in free text (a member who picked from the catalogue
     * since keeps their choice). Only the levels the vehicle had as text change; a model of another make brings its make along.
     */
    private function relink(CatalogRequest $request, Make $make, ?VehicleModel $model, ?Generation $generation): bool
    {
        $vehicleId = $request->getAttribute('vehicle_id');
        $vehicle = is_string($vehicleId) ? Vehicle::withTrashed()->whereKey($vehicleId)->lockForUpdate()->first() : null;

        if ($vehicle === null || $vehicle->owner_id !== $request->getAttribute('user_id')) {
            return false;
        }

        $makeIsText = $vehicle->getAttribute('make_id') === null;
        $modelIsText = $vehicle->getAttribute('model_id') === null;

        if (! $makeIsText && ! $modelIsText) {
            return false;
        }

        $changes = [];

        if ($makeIsText) {
            $changes += ['make_id' => $make->getKey(), 'make_text' => null];
        }

        if ($modelIsText && $model !== null) {
            $changes += ['model_id' => $model->getKey(), 'model_text' => null, 'generation_id' => $generation?->getKey()];
        }

        if ($changes === []) {
            return false;
        }

        $vehicle->forceFill($changes);
        $vehicle->forceFill(RelinkCatalogVehicles::canonicalIds(
            is_numeric($vehicle->getAttribute('make_id')) ? (int) $vehicle->getAttribute('make_id') : null,
            is_numeric($vehicle->getAttribute('model_id')) ? (int) $vehicle->getAttribute('model_id') : null,
            is_numeric($vehicle->getAttribute('generation_id')) ? (int) $vehicle->getAttribute('generation_id') : null,
        ));
        $vehicle->unsetRelations();
        $vehicle->forceFill(['slug' => $vehicle->canonicalSlug()]);
        // Staff linked the catalogue, the member changed nothing: "Zuletzt aktualisiert" stays.
        $vehicle->timestamps = false;
        $vehicle->saveQuietly();
        $this->search->queue($vehicle);

        return true;
    }
}
