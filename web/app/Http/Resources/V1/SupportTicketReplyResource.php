<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * SET-15b: the thread after the member wrote again, answered 201 (a message was created).
 */
class SupportTicketReplyResource extends SupportTicketThreadResource
{
    public function withResponse(Request $request, JsonResponse $response): void
    {
        $response->setStatusCode(201);
    }
}
