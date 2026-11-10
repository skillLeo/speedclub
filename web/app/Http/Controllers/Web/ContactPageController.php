<?php

namespace App\Http\Controllers\Web;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\SupportCategory;
use App\Http\Controllers\Controller;
use App\Http\Requests\Web\ContactFormRequest;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-10 /kontakt: a guest ticket for the team (ADM-25). GET without a session (ADR-115); the POST is sessionless too, limited per IP
 * (throttle:contact-form), with Turnstile when configured and the same cross-site refusal as WEB-05.
 */
class ContactPageController extends Controller
{
    public function show(): Response
    {
        return response()->view('public.contact', ['state' => 'form']);
    }

    public function store(ContactFormRequest $request, CreateSupportTicket $action): Response
    {
        $ticket = $action->forGuest(
            trim($request->string('name')->toString()),
            $request->email(),
            SupportCategory::from($request->string('category')->toString()),
            trim($request->string('message')->toString()),
            app()->getLocale(),
        );

        return response()->view('public.contact', ['state' => 'sent', 'reference' => CreateSupportTicket::reference($ticket)]);
    }
}
