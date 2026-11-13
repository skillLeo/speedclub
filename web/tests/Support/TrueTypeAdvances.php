<?php

namespace Tests\Support;

use RuntimeException;

/**
 * SF-R2-2 / NH-2: the real advance widths of a shipped TrueType font, read from its own tables, so the spec strip estimate is
 * tested against the font and not against its own numbers. Reads head (unitsPerEm), hhea + hmtx (advances), the Unicode BMP
 * cmap (format 4) and the GSUB 'tnum' single substitutions (lookup type 1, formats 1 and 2, also behind an extension lookup),
 * which font-variant-numeric: tabular-nums applies. SF-R3-2 (ADR-425 as amended): also the GPOS pair kerning of the 'kern'
 * feature for the default language system of DFLT and latn (lookup type 2, formats 1 and 2, also behind an extension lookup),
 * so the estimates' positive-kerning tables are tested against the font as well.
 */
final class TrueTypeAdvances
{
    /** @var array<string, array{offset: int, length: int}> */
    private array $tables = [];

    /** @var array<int, int> code point → glyph id */
    private array $cmap = [];

    /** @var list<int> glyph id → advance in font units */
    private array $advances = [];

    /** @var array<int, int> glyph id → tabular glyph id */
    private array $tnum = [];

    public readonly int $unitsPerEm;

    public function __construct(private readonly string $bytes)
    {
        $numTables = $this->u16(4);

        for ($i = 0; $i < $numTables; $i++) {
            $record = 12 + 16 * $i;
            $this->tables[substr($bytes, $record, 4)] = ['offset' => $this->u32($record + 8), 'length' => $this->u32($record + 12)];
        }

        $this->unitsPerEm = $this->u16($this->table('head') + 18);
        $this->readAdvances();
        $this->readCmap();
        $this->readTnum();
    }

    public static function fromFile(string $path): self
    {
        $bytes = file_get_contents($path);

        if ($bytes === false) {
            throw new RuntimeException('Cannot read '.$path);
        }

        return new self($bytes);
    }

    public function hasCharacter(string $char): bool
    {
        return isset($this->cmap[mb_ord($char)]);
    }

    /** The advance in font units the character renders with; with $tabular the 'tnum' substitute when the font has one. */
    public function advance(string $char, bool $tabular = true): int
    {
        $glyph = $this->cmap[mb_ord($char)] ?? throw new RuntimeException(sprintf('U+%04X is not in the cmap', mb_ord($char)));

        if ($tabular && isset($this->tnum[$glyph])) {
            $glyph = $this->tnum[$glyph];
        }

        return $this->advances[min($glyph, count($this->advances) - 1)];
    }

    /** The advance in em. */
    public function em(string $char, bool $tabular = true): float
    {
        return $this->advance($char, $tabular) / $this->unitsPerEm;
    }

    /**
     * The positive pair kerning the font's 'kern' lookups can apply between two of `$chars` (digits as their 'tnum' substitutes
     * with `$tabular`): per ordered pair the largest XAdvance adjustment (first plus second value record) of any PairPos record
     * that covers it, in font units, only where it is above 0. The largest, not the first match, so the result is the bound the
     * estimates need (never below what the shaper adds).
     *
     * @param  list<string>  $chars
     * @return array<string, int> pair (two characters) → font units
     */
    public function positivePairs(array $chars, bool $tabular): array
    {
        $glyphs = [];

        foreach ($chars as $char) {
            if ($this->hasCharacter($char)) {
                $glyph = $this->cmap[mb_ord($char)];
                $glyphs[$char] = $tabular && isset($this->tnum[$glyph]) ? $this->tnum[$glyph] : $glyph;
            }
        }

        /** @var array<int, array<int, int>> $best first glyph → second glyph → largest adjustment */
        $best = [];

        foreach ($this->pairSubtables() as $subtable) {
            $this->readPairs($subtable, array_values(array_unique($glyphs)), $best);
        }

        $pairs = [];

        foreach ($glyphs as $first => $firstGlyph) {
            foreach ($glyphs as $second => $secondGlyph) {
                $value = $best[$firstGlyph][$secondGlyph] ?? 0;

                if ($value > 0) {
                    $pairs[$first.$second] = $value;
                }
            }
        }

        return $pairs;
    }

    /**
     * The 'kern' feature's lookups of the default language system of DFLT and latn (the scripts a Latin name is shaped with),
     * as the PairPos subtables they hold.
     *
     * @return list<int>
     */
    private function pairSubtables(): array
    {
        $gpos = $this->table('GPOS');
        $scripts = $gpos + $this->u16($gpos + 4);
        $features = $gpos + $this->u16($gpos + 6);
        $lookups = $gpos + $this->u16($gpos + 8);
        $indices = [];

        for ($i = 0; $i < $this->u16($scripts); $i++) {
            $record = $scripts + 2 + 6 * $i;

            if (! in_array(substr($this->bytes, $record, 4), ['DFLT', 'latn'], true)) {
                continue;
            }

            $script = $scripts + $this->u16($record + 4);
            $langSys = $this->u16($script);

            if ($langSys === 0) {
                continue;
            }

            $langSys += $script;

            for ($j = 0; $j < $this->u16($langSys + 4); $j++) {
                $feature = $features + 2 + 6 * $this->u16($langSys + 6 + 2 * $j);

                if (substr($this->bytes, $feature, 4) !== 'kern') {
                    continue;
                }

                $table = $features + $this->u16($feature + 4);

                for ($k = 0; $k < $this->u16($table + 2); $k++) {
                    $indices[$this->u16($table + 4 + 2 * $k)] = true;
                }
            }
        }

        $subtables = [];

        foreach (array_keys($indices) as $index) {
            $lookup = $lookups + $this->u16($lookups + 2 + 2 * $index);
            $type = $this->u16($lookup);

            for ($k = 0; $k < $this->u16($lookup + 4); $k++) {
                $subtable = $lookup + $this->u16($lookup + 6 + 2 * $k);

                if ($type === 9 && $this->u16($subtable + 2) === 2) {
                    $subtables[] = $subtable + $this->u32($subtable + 4);
                } elseif ($type === 2) {
                    $subtables[] = $subtable;
                }
            }
        }

        return $subtables;
    }

    /**
     * One PairPos subtable (format 1: pair sets per first glyph; format 2: class pairs) into `$best`, for the given glyphs only.
     *
     * @param  list<int>  $glyphs
     * @param  array<int, array<int, int>>  $best
     */
    private function readPairs(int $subtable, array $glyphs, array &$best): void
    {
        $format = $this->u16($subtable);
        $covered = array_flip($this->coverage($subtable + $this->u16($subtable + 2)));
        [$format1, $format2] = [$this->u16($subtable + 4), $this->u16($subtable + 6)];
        $size1 = 2 * $this->bitCount($format1);
        $size2 = 2 * $this->bitCount($format2);
        $wanted = array_flip($glyphs);

        if ($format === 1) {
            foreach ($glyphs as $first) {
                if (! isset($covered[$first])) {
                    continue;
                }

                $set = $subtable + $this->u16($subtable + 10 + 2 * $covered[$first]);

                for ($r = 0; $r < $this->u16($set); $r++) {
                    $record = $set + 2 + $r * (2 + $size1 + $size2);
                    $second = $this->u16($record);

                    if (isset($wanted[$second])) {
                        $value = $this->xAdvance($record + 2, $format1) + $this->xAdvance($record + 2 + $size1, $format2);
                        $best[$first][$second] = max($best[$first][$second] ?? PHP_INT_MIN, $value);
                    }
                }
            }

            return;
        }

        if ($format !== 2) {
            return;
        }

        $classDef1 = $subtable + $this->u16($subtable + 8);
        $classDef2 = $subtable + $this->u16($subtable + 10);
        $class2Count = $this->u16($subtable + 14);

        foreach ($glyphs as $first) {
            if (! isset($covered[$first])) {
                continue;
            }

            $row = $subtable + 16 + $this->classOf($classDef1, $first) * $class2Count * ($size1 + $size2);

            foreach ($glyphs as $second) {
                $record = $row + $this->classOf($classDef2, $second) * ($size1 + $size2);
                $value = $this->xAdvance($record, $format1) + $this->xAdvance($record + $size1, $format2);
                $best[$first][$second] = max($best[$first][$second] ?? PHP_INT_MIN, $value);
            }
        }
    }

    /** The XAdvance field (signed) of a value record with this value format, 0 when it has none. */
    private function xAdvance(int $record, int $valueFormat): int
    {
        if (($valueFormat & 0x0004) === 0) {
            return 0;
        }

        $value = $this->u16($record + 2 * $this->bitCount($valueFormat & 0x0003));

        return $value >= 0x8000 ? $value - 0x10000 : $value;
    }

    private function bitCount(int $value): int
    {
        return substr_count(decbin($value & 0xFFFF), '1');
    }

    /** A glyph's class in a ClassDef table (formats 1 and 2); 0 for a glyph it does not list. */
    private function classOf(int $classDef, int $glyph): int
    {
        if ($this->u16($classDef) === 1) {
            $start = $this->u16($classDef + 2);
            $index = $glyph - $start;

            return $index >= 0 && $index < $this->u16($classDef + 4) ? $this->u16($classDef + 6 + 2 * $index) : 0;
        }

        for ($i = 0; $i < $this->u16($classDef + 2); $i++) {
            $range = $classDef + 4 + 6 * $i;

            if ($glyph >= $this->u16($range) && $glyph <= $this->u16($range + 2)) {
                return $this->u16($range + 4);
            }
        }

        return 0;
    }

    /** The unkerned width of a string in em. */
    public function width(string $text): float
    {
        return array_sum(array_map(fn (string $char): float => $this->em($char), mb_str_split($text)));
    }

    private function readAdvances(): void
    {
        $count = $this->u16($this->table('hhea') + 34);
        $hmtx = $this->table('hmtx');

        for ($i = 0; $i < $count; $i++) {
            $this->advances[] = $this->u16($hmtx + 4 * $i);
        }
    }

    private function readCmap(): void
    {
        $cmap = $this->table('cmap');
        $subtable = null;

        for ($i = 0; $i < $this->u16($cmap + 2); $i++) {
            $record = $cmap + 4 + 8 * $i;
            [$platform, $encoding] = [$this->u16($record), $this->u16($record + 2)];
            $offset = $cmap + $this->u32($record + 4);

            if ((($platform === 3 && $encoding === 1) || $platform === 0) && $this->u16($offset) === 4) {
                $subtable = $offset;
            }
        }

        if ($subtable === null) {
            throw new RuntimeException('No format 4 Unicode cmap');
        }

        $segments = $this->u16($subtable + 6) / 2;
        $ends = $subtable + 14;
        $starts = $ends + 2 * $segments + 2;
        $deltas = $starts + 2 * $segments;
        $rangeOffsets = $deltas + 2 * $segments;

        for ($s = 0; $s < $segments; $s++) {
            [$start, $end] = [$this->u16($starts + 2 * $s), $this->u16($ends + 2 * $s)];
            $delta = $this->u16($deltas + 2 * $s);
            $rangeOffset = $this->u16($rangeOffsets + 2 * $s);

            for ($code = $start; $code <= $end && $code !== 0xFFFF; $code++) {
                if ($rangeOffset === 0) {
                    $glyph = ($code + $delta) & 0xFFFF;
                } else {
                    $glyph = $this->u16($rangeOffsets + 2 * $s + $rangeOffset + 2 * ($code - $start));
                    $glyph = $glyph === 0 ? 0 : ($glyph + $delta) & 0xFFFF;
                }

                if ($glyph !== 0) {
                    $this->cmap[$code] = $glyph;
                }
            }
        }
    }

    private function readTnum(): void
    {
        if (! isset($this->tables['GSUB'])) {
            return;
        }

        $gsub = $this->table('GSUB');
        $features = $gsub + $this->u16($gsub + 6);
        $lookups = $gsub + $this->u16($gsub + 8);

        for ($i = 0; $i < $this->u16($features); $i++) {
            $record = $features + 2 + 6 * $i;

            if (substr($this->bytes, $record, 4) !== 'tnum') {
                continue;
            }

            $feature = $features + $this->u16($record + 4);

            for ($j = 0; $j < $this->u16($feature + 2); $j++) {
                $lookup = $lookups + $this->u16($lookups + 2 + 2 * $this->u16($feature + 4 + 2 * $j));
                $type = $this->u16($lookup);

                for ($k = 0; $k < $this->u16($lookup + 4); $k++) {
                    $subtable = $lookup + $this->u16($lookup + 6 + 2 * $k);

                    if ($type === 7) {
                        $this->readSingleSubstitution($subtable + $this->u32($subtable + 4), $this->u16($subtable + 2));
                    } else {
                        $this->readSingleSubstitution($subtable, $type);
                    }
                }
            }
        }
    }

    private function readSingleSubstitution(int $subtable, int $type): void
    {
        if ($type !== 1) {
            return;
        }

        $format = $this->u16($subtable);

        foreach ($this->coverage($subtable + $this->u16($subtable + 2)) as $index => $glyph) {
            $this->tnum[$glyph] = $format === 1
                ? ($glyph + $this->u16($subtable + 4)) & 0xFFFF
                : $this->u16($subtable + 6 + 2 * $index);
        }
    }

    /** @return list<int> the covered glyph ids in coverage index order */
    private function coverage(int $offset): array
    {
        $glyphs = [];

        if ($this->u16($offset) === 1) {
            for ($i = 0; $i < $this->u16($offset + 2); $i++) {
                $glyphs[] = $this->u16($offset + 4 + 2 * $i);
            }

            return $glyphs;
        }

        for ($i = 0; $i < $this->u16($offset + 2); $i++) {
            $range = $offset + 4 + 6 * $i;

            for ($glyph = $this->u16($range); $glyph <= $this->u16($range + 2); $glyph++) {
                $glyphs[] = $glyph;
            }
        }

        return $glyphs;
    }

    private function table(string $tag): int
    {
        return ($this->tables[$tag] ?? throw new RuntimeException('No '.$tag.' table'))['offset'];
    }

    private function u16(int $offset): int
    {
        return (ord($this->bytes[$offset]) << 8) | ord($this->bytes[$offset + 1]);
    }

    private function u32(int $offset): int
    {
        return ($this->u16($offset) << 16) | $this->u16($offset + 2);
    }
}
