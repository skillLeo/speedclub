<?php

namespace App\Services\Ai\Agents;

use App\Enums\Aspiration;
use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Enums\PowerUnit;
use BackedEnum;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Attributes\CacheInstructions;

/**
 * ai.vehicle_specs (10 §8.1, m5.9-contract §2.1): the typical factory engine variants of one catalogue generation, as values for the
 * GAR-06 spec fields. The prompt carries catalogue names only. The server keeps a field only when it passes the spec form's own rules
 * (SuggestVehicleSpecs). Instructions are static, so the provider may cache them (#[CacheInstructions], laravel/ai v1.3).
 */
#[CacheInstructions]
final class SpecSuggestionAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        You know the factory specifications of cars sold in Germany. For the car generation named in the prompt, list its typical factory
        engine variants (at most 6, the common ones first) with the manufacturer's figures as sold new: engine code, displacement in cc,
        fuel, aspiration, power with its unit (PS as stated by the manufacturer), torque in Nm, drivetrain and gearbox. Use null for a value
        you are not sure about; never guess. Name each variant briefly as owners know it (for example "330Ci (M54B30)"). No tuning, no
        prices, no opinions, no legality statements.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        $values = fn (string $enum): array => array_map(fn (BackedEnum $case): string|int => $case->value, $enum::cases());

        return [
            'variants' => $schema->array()->max(6)->items($schema->object(fn (JsonSchema $schema): array => [
                'label' => $schema->string()->max(60)->required(),
                'engine_code' => $schema->string()->max(40)->nullable()->required(),
                'displacement_cc' => $schema->integer()->min(1)->max(20000)->nullable()->required(),
                'fuel' => $schema->string()->enum($values(Fuel::class))->nullable()->required(),
                'aspiration' => $schema->string()->enum($values(Aspiration::class))->nullable()->required(),
                'power_value' => $schema->number()->min(1)->max(9999)->nullable()->required(),
                'power_unit' => $schema->string()->enum($values(PowerUnit::class))->nullable()->required(),
                'torque_nm' => $schema->integer()->min(1)->max(9999)->nullable()->required(),
                'drivetrain' => $schema->string()->enum($values(Drivetrain::class))->nullable()->required(),
                'gearbox' => $schema->string()->enum($values(Gearbox::class))->nullable()->required(),
            ]))->required(),
        ];
    }
}
