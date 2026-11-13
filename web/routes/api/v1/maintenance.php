<?php

use App\Http\Controllers\Api\V1\Maintenance\MaintenanceItemController;
use App\Http\Controllers\Api\V1\Maintenance\MaintenanceLogController;
use App\Http\Controllers\Api\V1\Maintenance\MaintenancePhotoController;
use App\Http\Controllers\Api\V1\Maintenance\MyMaintenanceController;
use App\Http\Controllers\Api\V1\Maintenance\VehicleMaintenanceController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M4.13 Garage pro (09 §8.8, §11): maintenance items, the service log with private costs and photos, the odometer, cost totals,
// upcoming items and the reminder plan. Owner-only (VehiclePolicy::maintain). Flag `maintenance` after `member`, so a guest hears 401
// first. Private data, not publishing: a publishing restriction does not stop it.
$id = '[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}';
$flag = EnsureFeatureEnabled::class.':maintenance';

Route::middleware(['member', $flag])->group(function () use ($id): void {
    Route::get('me/maintenance/upcoming', [MyMaintenanceController::class, 'upcoming'])->middleware(['throttle:browse', 'etag'])->name('me.maintenance.upcoming');
    Route::get('me/maintenance/reminders', [MyMaintenanceController::class, 'reminders'])->middleware(['throttle:browse', 'etag'])->name('me.maintenance.reminders');

    Route::get('vehicles/{vehicle}/maintenance-items', [MaintenanceItemController::class, 'index'])->middleware(['throttle:browse', 'etag'])->name('vehicles.maintenance-items.index');
    Route::post('vehicles/{vehicle}/maintenance-items', [MaintenanceItemController::class, 'store'])
        ->middleware(['throttle:garage-writes', 'idempotent'])->name('vehicles.maintenance-items.store');
    Route::patch('vehicles/{vehicle}/maintenance-items/{item}', [MaintenanceItemController::class, 'update'])->where('item', $id)
        ->middleware('throttle:garage-edits')->name('vehicles.maintenance-items.update');
    Route::delete('vehicles/{vehicle}/maintenance-items/{item}', [MaintenanceItemController::class, 'destroy'])->where('item', $id)
        ->middleware('throttle:garage-edits')->name('vehicles.maintenance-items.destroy');

    Route::get('vehicles/{vehicle}/maintenance-logs', [MaintenanceLogController::class, 'index'])->middleware('throttle:browse')->name('vehicles.maintenance-logs.index');
    Route::post('vehicles/{vehicle}/maintenance-logs', [MaintenanceLogController::class, 'store'])
        ->middleware(['throttle:garage-writes', 'idempotent'])->name('vehicles.maintenance-logs.store');
    Route::get('vehicles/{vehicle}/maintenance-logs/{log}', [MaintenanceLogController::class, 'show'])->where('log', $id)
        ->middleware('throttle:browse')->name('vehicles.maintenance-logs.show');
    Route::patch('vehicles/{vehicle}/maintenance-logs/{log}', [MaintenanceLogController::class, 'update'])->where('log', $id)
        ->middleware('throttle:garage-edits')->name('vehicles.maintenance-logs.update');
    Route::delete('vehicles/{vehicle}/maintenance-logs/{log}', [MaintenanceLogController::class, 'destroy'])->where('log', $id)
        ->middleware('throttle:garage-edits')->name('vehicles.maintenance-logs.destroy');
    Route::post('vehicles/{vehicle}/maintenance-logs/{log}/photos', [MaintenancePhotoController::class, 'store'])->where('log', $id)
        ->middleware(['throttle:uploads', 'idempotent'])->name('vehicles.maintenance-logs.photos.store');
    Route::delete('vehicles/{vehicle}/maintenance-logs/{log}/photos/{media}', [MaintenancePhotoController::class, 'destroy'])->where(['log' => $id, 'media' => $id])
        ->middleware('throttle:garage-edits')->name('vehicles.maintenance-logs.photos.destroy');

    Route::put('vehicles/{vehicle}/odometer', [VehicleMaintenanceController::class, 'odometer'])->middleware('throttle:garage-edits')->name('vehicles.odometer');
    Route::get('vehicles/{vehicle}/costs', [VehicleMaintenanceController::class, 'costs'])->middleware('throttle:browse')->name('vehicles.costs');
});

// Service log photos from the private disk: the signed URL is the credential, bound to the photo, the width and the viewer, who must
// still own the vehicle when it is fetched. Outside the flag, like chat media: a URL handed out stays a photo or a 404.
Route::get('maintenance-media/{media}/{width}', [MaintenancePhotoController::class, 'show'])
    ->whereNumber('width')
    ->middleware(['signed', 'throttle:public-read'])
    ->name('maintenance-media.show');
