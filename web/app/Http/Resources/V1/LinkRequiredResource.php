<?php

namespace App\Http\Resources\V1;

use App\Enums\SocialProvider;
use App\Support\Auth\LinkRequired;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * 202 of POST auth/apple or auth/google when the address belongs to an existing account (AUTH-16): no session yet. Send attempt_id and
 * the code mailed to email_hint to POST auth/link/confirm.
 *
 * @property LinkRequired $resource
 */
class LinkRequiredResource extends JsonResource
{
    /**
     * @return array{link_required: true, provider: SocialProvider, attempt_id: string, email_hint: string, resend_after: int}
     */
    public function toArray(Request $request): array
    {
        return [
            'link_required' => true,
            'provider' => $this->resource->provider,
            'attempt_id' => $this->resource->attemptId,
            /** "s•••@gmail.com" */
            'email_hint' => $this->resource->emailHint,
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
