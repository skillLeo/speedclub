<?php

namespace Tests\Fixtures\Arch;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;

class GoodApiController
{
    public function __construct(private readonly string $name = 'x') {}

    public function show(): JsonResource
    {
        return new JsonResource(['name' => $this->name]);
    }

    public function store(): JsonResponse
    {
        return (new JsonResource(['name' => $this->name]))->response()->setStatusCode(201);
    }

    public function destroy(): Response
    {
        return response()->noContent();
    }
}
