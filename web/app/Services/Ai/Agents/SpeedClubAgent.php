<?php

namespace App\Services\Ai\Agents;

use App\Services\Ai\NeverList;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasStructuredOutput;
use Laravel\Ai\Promptable;

/**
 * One [AI] feature as a Laravel AI SDK agent (laravel/ai Promptable): its task, then the "Never" rules of 02 §6 (NeverList::RULES), and a
 * JSON schema for structured output that always carries `refused`. Prompted only through AiGateway::ask(), which sets provider, model
 * and timeout. No tools, no conversation memory: one stateless call per request.
 */
abstract class SpeedClubAgent implements Agent, HasStructuredOutput
{
    use Promptable;

    abstract protected function task(): string;

    /**
     * The feature's own fields of the answer.
     *
     * @return array<string, Type>
     */
    abstract protected function fields(JsonSchema $schema): array;

    public function instructions(): string
    {
        return trim($this->task())."\n\n".NeverList::RULES;
    }

    /**
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'refused' => $schema->boolean()->description('True when the input asks for anything outside this task or the hard rules.')->required(),
            ...$this->fields($schema),
        ];
    }
}
