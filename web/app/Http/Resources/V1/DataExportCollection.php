<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

/**
 * SET-12's list. The rows carry the signed download_url, a credential for 7 days: Cache-Control: no-store.
 */
class DataExportCollection extends ResourceCollection
{
    public $collects = DataExportResource::class;

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->headers->set('Cache-Control', 'no-store, private');
    }
}
