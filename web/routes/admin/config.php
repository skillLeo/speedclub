<?php

use App\Http\Controllers\Admin\Config\ConfigDraftController;
use App\Http\Controllers\Admin\Config\FlagsController;
use App\Http\Controllers\Admin\Config\ReleasesController;
use App\Http\Controllers\Admin\Config\RemoteController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// ADM-36…38 (m3.5-contract §2), Owner and Admin only (flags.manage, remote_config.manage, releases.manage). ⚿ = staff.recent-password
// on every flag and remote-config write (maintenance on only creates the `maintenance.enable` approval; a critical flag in production
// the `flags.critical_change` one). Register entries and the RELEASES.md sync change nothing at runtime (allow-listed with reasons).
Route::middleware(AdminRoutes::signedIn())->prefix('config')->name('config.')->group(function (): void {
    Route::middleware('can:flags.manage')->group(function (): void {
        Route::get('flags', [FlagsController::class, 'index'])->name('flags');
        Route::patch('flags/{flag}', [FlagsController::class, 'update'])->middleware(['staff.recent-password', 'throttle:30,1'])->whereNumber('flag')->name('flags.update');
    });

    Route::middleware('can:remote_config.manage')->group(function (): void {
        Route::get('remote', RemoteController::class)->name('remote');
        Route::middleware(['staff.recent-password', 'throttle:30,1'])->group(function (): void {
            Route::post('remote/draft', [ConfigDraftController::class, 'save'])->defaults('key', 'remote_config')->name('remote.draft.save');
            Route::delete('remote/draft', [ConfigDraftController::class, 'discard'])->defaults('key', 'remote_config')->name('remote.draft.discard');
            Route::post('remote/publish', [ConfigDraftController::class, 'publish'])->defaults('key', 'remote_config')->name('remote.publish');
        });
    });

    Route::middleware('can:releases.manage')->group(function (): void {
        Route::get('releases', [ReleasesController::class, 'index'])->name('releases');
        Route::middleware('throttle:30,1')->group(function (): void {
            Route::post('releases', [ReleasesController::class, 'store'])->name('releases.store');
            Route::patch('releases/{release}', [ReleasesController::class, 'update'])->whereNumber('release')->name('releases.update');
            Route::post('releases/sync', [ReleasesController::class, 'sync'])->middleware('throttle:6,1')->name('releases.sync');
        });
    });
});
