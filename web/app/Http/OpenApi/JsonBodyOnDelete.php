<?php

namespace App\Http\OpenApi;

use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\RequestBodyObject;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;

/**
 * Scramble lists the fields of a DELETE's FormRequest as query parameters. These operations take a password, which must never travel in
 * a URL (access logs, history): their fields are documented as a JSON request body, which is what the server reads (M2.5 review,
 * OpenAPI drift). A document transformer, so it runs after Scramble has added the parameters.
 */
final class JsonBodyOnDelete
{
    /** operationId of each DELETE that carries a JSON body. */
    public const OPERATIONS = ['v1.me.two-factor.destroy'];

    public static function document(OpenApi $openApi): void
    {
        foreach ($openApi->paths as $path) {
            foreach ($path->operations as $operation) {
                if (in_array($operation->operationId, self::OPERATIONS, true)) {
                    self::moveToBody($operation);
                }
            }
        }
    }

    private static function moveToBody(Operation $operation): void
    {
        $body = new ObjectType;
        $required = [];
        $kept = [];

        foreach ($operation->parameters as $parameter) {
            if (! $parameter instanceof Parameter || $parameter->in !== 'query') {
                $kept[] = $parameter;

                continue;
            }

            if ($parameter->schema instanceof Schema) {
                $body->addProperty($parameter->name, $parameter->schema->type);
            }

            if ($parameter->required) {
                $required[] = $parameter->name;
            }
        }

        $body->setRequired($required);
        $operation->parameters = $kept;
        $operation->addRequestBodyObject(RequestBodyObject::make()->setContent('application/json', Schema::fromType($body)));
    }
}
