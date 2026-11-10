<?php

namespace App\Services\Ai;

/**
 * The structured answer of one provider call that passed the gateway's own checks, with the ai_calls row it was logged as (so a
 * feature's post-check can mark it invalid, AiGateway::reject()).
 */
final readonly class AiAnswer
{
    /**
     * @param  array<string, mixed>  $data
     */
    public function __construct(public string $callId, public array $data) {}

    public function string(string $key): ?string
    {
        $value = $this->data[$key] ?? null;

        return is_string($value) ? $value : null;
    }

    /**
     * @return list<mixed>
     */
    public function list(string $key): array
    {
        $value = $this->data[$key] ?? null;

        return is_array($value) ? array_values($value) : [];
    }
}
