<?php

namespace App\Http\Resources\V1;

use App\Support\Auth\EmailCodeStarted;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The neutral 202 of an e-mail code request (09 §8.1): the client's attempt id and the seconds until "Neuen Code senden".
 *
 * @property EmailCodeStarted $resource
 */
class EmailCodeStartedResource extends JsonResource
{
    /**
     * @return array{attempt_id: string, resend_after: int}
     */
    public function toArray(Request $request): array
    {
        return [
            'attempt_id' => $this->resource->attemptId,
            /** Seconds until the next code may be asked for (30, 60, then 120; longer during a lock or above 5 codes an hour). */
            'resend_after' => $this->resource->resendAfter,
        ];
    }

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->setStatusCode(202);
        $response->headers->set('Cache-Control', 'no-store, private');
    }
}
