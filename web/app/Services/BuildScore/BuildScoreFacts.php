<?php

namespace App\Services\BuildScore;

/**
 * What the Build Score of one vehicle counts (BuildScoreInputs gathers it, BuildScoreCalculator turns it into points). Counts only:
 * never a power, torque, speed, sound or money value (10 §16.3). Each person is in a community count at most once.
 */
final readonly class BuildScoreFacts
{
    public function __construct(
        /** Usable gallery photos of the vehicle. */
        public int $photos = 0,
        /** Key specs that are filled (BuildScoreInputs::KEY_SPECS), never their values. */
        public int $keySpecs = 0,
        /** Characters of the trimmed description. */
        public int $descriptionChars = 0,
        /** A usable cover photo with a focal point set. */
        public bool $coverFocal = false,
        /** Mods (not planned) with brand, a usable photo and a date. */
        public int $documentedMods = 0,
        /** Mods (not planned) that miss brand, photo or date. */
        public int $undocumentedMods = 0,
        /** Mods (not planned) the owner states as entered in the papers (legal_status registered or individual_approval). */
        public int $registeredMods = 0,
        /** Mods that are not planned (what could be stated as entered). */
        public int $existingMods = 0,
        /** Planned mods (ModStatus::Planned): "Geplante Mods dokumentieren". */
        public int $plannedMods = 0,
        /** Distinct members who reacted to the car or its visible build updates. */
        public int $reactors = 0,
        /** Distinct members with a counted spot of the car. */
        public int $spotters = 0,
        /** Distinct members following the car. */
        public int $followers = 0,
        /** Visible entries the owner wrote (posts and notes). */
        public int $timeline = 0,
        /** Before/after pairs with both photos usable. */
        public int $beforeAfter = 0,
        /** Full months between the first and the last documented date (updates and mods). */
        public int $historyMonths = 0,
    ) {}

    /**
     * The units each formula item counts.
     *
     * @return array<string, int>
     */
    public function units(int $descriptionMinChars): array
    {
        return [
            'photos' => $this->photos,
            'key_specs' => $this->keySpecs,
            'description' => $this->descriptionChars >= $descriptionMinChars ? 1 : 0,
            'cover_focal' => $this->coverFocal ? 1 : 0,
            'documented_mods' => $this->documentedMods,
            'registered_mods' => $this->registeredMods,
            'reactors' => $this->reactors,
            'spotters' => $this->spotters,
            'followers' => $this->followers,
            'timeline' => $this->timeline,
            'before_after' => $this->beforeAfter,
            'history_span' => $this->historyMonths,
        ];
    }
}
