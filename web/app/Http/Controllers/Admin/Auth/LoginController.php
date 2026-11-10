<?php

namespace App\Http\Controllers\Admin\Auth;

use App\Http\Controllers\Controller;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-01 sign-in page; the POST is handled by Fortify (guard "staff", prefix "admin").
 */
class LoginController extends Controller
{
    public function __invoke(): Response
    {
        return Inertia::render('Auth/Login');
    }
}
