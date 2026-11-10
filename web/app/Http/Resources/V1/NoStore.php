<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Answers that carry a secret (a TOTP key, recovery codes): no cache anywhere may keep them (m2.5-contract §1).
 */
trait NoStore
{
    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Pragma', 'no-cache');
    }
}
