<?php

use App\Http\Controllers\Admin\Dev\GalleryController;
use App\Http\Controllers\Admin\Support\AdminRoutes;
use Illuminate\Support\Facades\Route;

// Admin gallery for design QA and the visual tier: local and testing only, never registered elsewhere.
if (app()->environment(['local', 'testing'])) {
    Route::middleware(AdminRoutes::signedIn())->get('dev/gallery', GalleryController::class)->name('dev.gallery');
}
