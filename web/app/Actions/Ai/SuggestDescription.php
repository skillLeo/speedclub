<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Ai\Agents\DescriptionAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use App\Services\Ai\NeverList;
use App\Services\Ai\Numbers;
use BackedEnum;

/**
 * POST ai/vehicles/{vehicle}/description (ai.description_assist, opt-in; GAR-03 step 3 "Beschreibung vorschlagen"): a description from the
 * vehicle's structured data only (make, model, generation, year, specs, modifications), never its existing description or anything a
 * member wrote freely. Post-check: a number that is not in that data, or a legality or power claim it did not contain, makes the answer
 * unverifiable (422 ai_unverifiable, outcome invalid). Nothing is saved: the app puts the text into the field, labelled until edited.
 *
 * @throws AiFailed
 */
class SuggestDescription
{
    public function __construct(private readonly AiGateway $gateway) {}

    /**
     * @return array{text: string}
     */
    public function handle(User $member, Vehicle $vehicle): array
    {
        $this->gateway->ensureMayUse(AiFeature::DescriptionAssist, $member);

        $data = json_encode($this->facts($vehicle), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
        $prompt = 'Language: '.(app()->getLocale() === 'en' ? 'English' : 'German')."\nStructured data (JSON):\n".$data;

        $answer = $this->gateway->ask(AiFeature::DescriptionAssist, new DescriptionAgent, $prompt, member: $member);
        $text = trim((string) $answer->string('text'));

        if ($text === '' || mb_strlen($text) > 600 || ! Numbers::allFrom($text, $data) || NeverList::violatedBy($text, $data)) {
            $this->gateway->reject($answer);
        }

        return ['text' => $text];
    }

    /**
     * The structured data, without ids, prices or anything free-text a member typed but part names.
     *
     * @return array<string, mixed>
     */
    private function facts(Vehicle $vehicle): array
    {
        $vehicle->loadMissing(['make', 'vehicleModel', 'generation', 'specs', 'modifications.category', 'modifications.brand']);
        $specs = $vehicle->specs;
        $enum = fn (mixed $value): mixed => $value instanceof BackedEnum ? $value->value : $value;

        return array_filter([
            'make' => $vehicle->make?->getAttribute('name') ?? $vehicle->getAttribute('make_text'),
            'model' => $vehicle->vehicleModel?->getAttribute('name') ?? $vehicle->getAttribute('model_text'),
            'generation' => $vehicle->generation?->getAttribute('name'),
            'model_year' => $vehicle->getAttribute('model_year'),
            'specs' => $specs === null ? null : array_filter([
                'engine_code' => $specs->getAttribute('engine_code'),
                'displacement_cc' => $specs->getAttribute('displacement_cc'),
                'fuel' => $enum($specs->getAttribute('fuel')),
                'aspiration' => $enum($specs->getAttribute('aspiration')),
                'power' => $specs->getAttribute('power_value') === null ? null : $specs->getAttribute('power_value').' '.$enum($specs->getAttribute('power_unit')),
                'torque_nm' => $specs->getAttribute('torque_nm'),
                'drivetrain' => $enum($specs->getAttribute('drivetrain')),
                'gearbox' => $enum($specs->getAttribute('gearbox')),
            ], fn (mixed $value): bool => $value !== null && $value !== ''),
            'modifications' => $vehicle->modifications->take(40)->map(fn (Modification $mod): array => array_filter([
                'category' => $mod->category->getAttribute('name'),
                'brand' => $mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text'),
                'part' => $mod->getAttribute('part_name') ?? $mod->getAttribute('title'),
                'status' => $enum($mod->getAttribute('status')),
                'fields' => $mod->getAttribute('fields'),
            ], fn (mixed $value): bool => $value !== null && $value !== '' && $value !== []))->values()->all(),
        ], fn (mixed $value): bool => $value !== null && $value !== '' && $value !== []);
    }
}
