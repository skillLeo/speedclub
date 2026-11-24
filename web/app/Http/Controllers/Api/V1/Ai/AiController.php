<?php

namespace App\Http\Controllers\Api\V1\Ai;

use App\Actions\Ai\InterpretSearch;
use App\Actions\Ai\MatchProduct;
use App\Actions\Ai\SuggestDescription;
use App\Actions\Ai\SuggestModFields;
use App\Actions\Ai\SuggestPhotoCategory;
use App\Actions\Ai\SuggestVehicleSpecs;
use App\Actions\Ai\TranslateText;
use App\Enums\TranslationSource;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Ai\InterpretSearchRequest;
use App\Http\Requests\Api\V1\Ai\MatchProductRequest;
use App\Http\Requests\Api\V1\Ai\SuggestModRequest;
use App\Http\Requests\Api\V1\Ai\SuggestSpecsRequest;
use App\Http\Requests\Api\V1\Ai\TranslateRequest;
use App\Http\Resources\V1\Ai\DescriptionSuggestionResource;
use App\Http\Resources\V1\Ai\ModSuggestionResource;
use App\Http\Resources\V1\Ai\PhotoCategoryResource;
use App\Http\Resources\V1\Ai\ProductMatchResource;
use App\Http\Resources\V1\Ai\SearchInterpretationResource;
use App\Http\Resources\V1\Ai\SpecSuggestionResource;
use App\Http\Resources\V1\Ai\TranslationResource;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * M3.7 [AI] features (02_PRODUCT_SPEC §6, m3.7 contract §1). Each answers 404 `feature_disabled` while its `ai.*` flag is off or no AI
 * provider is configured, 403 `ai_opt_in_required` without the member's opt-in (`ai_suggestions` in PATCH me/settings; not for the
 * translation), 503 `ai_unavailable` when the provider fails or times out, 503 `ai_budget_exhausted` when the feature's daily budget is
 * spent, 422 `ai_refused` for a request outside what the feature may do, and 422 `ai_unverifiable` when the answer fails the server's
 * checks. Nothing is saved: every result is a suggestion the member confirms.
 */
class AiController extends Controller
{
    /**
     * Natural-language search → filter chips (ai.nl_search).
     *
     * The chips are resolved against the catalogue and the Discover facets; unknown values are dropped.
     */
    public function interpret(InterpretSearchRequest $request, InterpretSearch $action): SearchInterpretationResource
    {
        return new SearchInterpretationResource($action->handle($this->member($request), (string) $request->validated('q')));
    }

    /**
     * Modification fields from a pasted text (ai.mod_assist).
     *
     * Only fields of the category's schema, brands of the catalogue, and numbers that stand in the text.
     */
    public function suggestMod(SuggestModRequest $request, SuggestModFields $action): ModSuggestionResource
    {
        $key = $request->validated('category_key');

        return new ModSuggestionResource($action->handle($this->member($request), is_string($key) ? $key : null, (string) $request->validated('text')));
    }

    /**
     * Suggested category of an own photo (ai.photo_tagging).
     *
     * Owner only; the 640 px variant is analysed, never the original. 409 while the photo is still processing.
     */
    public function photoCategory(Request $request, Media $media, SuggestPhotoCategory $action): PhotoCategoryResource
    {
        Gate::authorize('update', $media);

        return new PhotoCategoryResource($action->handle($this->member($request), $media));
    }

    /**
     * Translate a description, a build update or a message (ai.translate).
     *
     * The member must be able to read the source (a message: participants only), else 404. Cached for 30 days per source and text.
     */
    public function translate(TranslateRequest $request, TranslateText $action): TranslationResource
    {
        $to = (string) $request->validated('to');
        $result = $action->handle($this->member($request), TranslationSource::from((string) $request->validated('source')), (string) $request->validated('id'), $to);

        return new TranslationResource([...$result, 'to' => $to]);
    }

    /**
     * Suggested description of an own vehicle (ai.description_assist).
     *
     * From the structured data only; a number that is not in it makes the answer 422 `ai_unverifiable`.
     */
    public function description(Request $request, Vehicle $vehicle, SuggestDescription $action): DescriptionSuggestionResource
    {
        Gate::authorize('update', $vehicle);

        return new DescriptionSuggestionResource($action->handle($this->member($request), $vehicle));
    }

    /**
     * Typical factory specs for the wizard (ai.vehicle_specs).
     *
     * M5.9 "Daten übernehmen?": for a catalogue generation (or a model and year without generations), cached for every member who picks
     * it, so a cached answer costs no call and no daily share. Only valid spec values; the member confirms in the form and sends
     * `ai_suggestion` with PUT vehicles/{id}/specs. 422 when the generation is unknown or inactive.
     */
    public function suggestSpecs(SuggestSpecsRequest $request, SuggestVehicleSpecs $action): SpecSuggestionResource
    {
        /** @var array{generation_id?: int|null, model_id?: int|null, model_year?: int|null} $input */
        $input = $request->validated();

        return new SpecSuggestionResource($action->handle($this->member($request), $input));
    }

    /**
     * Match a typed part to the catalogue (ai.product_match).
     *
     * M5.9 mod editor: every word against the catalogue first (no AI); only when nothing matches, the AI turns the text into catalogue
     * words and the server searches again. Answers catalogue products only, at most 3; empty when nothing matches.
     */
    public function matchProduct(MatchProductRequest $request, MatchProduct $action): ProductMatchResource
    {
        $category = $request->validated('category_key');

        return new ProductMatchResource($action->handle($this->member($request), (string) $request->validated('text'), is_string($category) ? $category : null));
    }

    private function member(Request $request): User
    {
        /** @var User $member */
        $member = $request->user();

        return $member;
    }
}
