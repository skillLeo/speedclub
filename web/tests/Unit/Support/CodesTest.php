<?php

use App\Support\Codes;
use Illuminate\Database\UniqueConstraintViolationException;

it('has the 32 Crockford characters without I, L, O and U', function () {
    expect(strlen(Codes::ALPHABET))->toBe(32)
        ->and(count(array_unique(str_split(Codes::ALPHABET))))->toBe(32)
        ->and(Codes::ALPHABET)->not->toContain('I', 'L', 'O', 'U');
});

it('generates valid 8-character codes that use the whole alphabet', function () {
    $seen = [];

    for ($i = 0; $i < 2000; $i++) {
        $code = Codes::generate();

        expect(strlen($code))->toBe(8)
            ->and(Codes::isValid($code))->toBeTrue();

        $seen += array_flip(str_split($code));
    }

    expect($seen)->toHaveCount(32);
});

it('validates strictly', function (string $code, bool $valid) {
    expect(Codes::isValid($code))->toBe($valid);
})->with([
    ['7H2KQXMB', true],
    ['00000000', true],
    ['7h2kqxmb', false],
    ['7H2KQXM', false],
    ['7H2KQXMBA', false],
    ['7H2KQXMI', false],
    ['7H2KQXML', false],
    ['7H2KQXMO', false],
    ['7H2KQXMU', false],
    ["7H2KQXMB\n", false],
    ['', false],
]);

it('normalises user input to the canonical form', function (string $input, ?string $expected) {
    expect(Codes::normalize($input))->toBe($expected);
})->with([
    'lowercase from /c/' => ['7h2kqxmb', '7H2KQXMB'],
    'surrounding spaces' => [' 7H2KQXMB ', '7H2KQXMB'],
    'O reads as 0' => ['O0000000', '00000000'],
    'I and L read as 1' => ['IL000000', '11000000'],
    'U is not a code character' => ['U0000000', null],
    'wrong length' => ['7H2', null],
    'the space the sticker prints' => ['8TR0 Q3MC', '8TR0Q3MC'],
    'Crockford hyphen in lower case' => ['8tr0-q3mc', '8TR0Q3MC'],
    'Unicode hyphen' => ["8TR0\u{2010}Q3MC", '8TR0Q3MC'],
    'en dash' => ["8TR0\u{2013}Q3MC", '8TR0Q3MC'],
    'horizontal bar' => ["8TR0\u{2015}Q3MC", '8TR0Q3MC'],
    'minus sign' => ["8TR0\u{2212}Q3MC", '8TR0Q3MC'],
    'no-break space' => ["8TR0\u{00A0}Q3MC", '8TR0Q3MC'],
    'ideographic space' => ["8TR0\u{3000}Q3MC", '8TR0Q3MC'],
    'byte order mark, as JavaScript counts it a space' => ["\u{FEFF}8TR0Q3MC", '8TR0Q3MC'],
    'tab and line break' => ["8TR0\t\nQ3MC", '8TR0Q3MC'],
    'read-alikes after the separators went' => ['oIlo-oooo', '01100000'],
    'only separators' => [' - ', null],
    'invalid UTF-8' => ["\xFF", null],
    'invalid UTF-8 inside a code' => ["8TR0\xFFQ3MC", null],
    'a dot is no separator' => ['8TR0.Q3MC', null],
    'too long once the separators went' => ['8TR0 Q3MC Q', null],
]);

function uniqueViolation(): UniqueConstraintViolationException
{
    return new UniqueConstraintViolationException('mysql', 'insert', [], new Exception('Duplicate entry'));
}

it('retries with a new code when the unique index reports a collision', function () {
    $seen = [];

    $result = Codes::createUnique(function (string $code) use (&$seen) {
        $seen[] = $code;

        if (count($seen) < 3) {
            throw uniqueViolation();
        }

        return $code;
    });

    expect($seen)->toHaveCount(3)
        ->and(array_unique($seen))->toHaveCount(3)
        ->and($result)->toBe($seen[2]);
});

it('gives up with the database error after the maximum number of attempts', function () {
    $attempts = 0;

    expect(function () use (&$attempts) {
        Codes::createUnique(function () use (&$attempts) {
            $attempts++;

            throw uniqueViolation();
        });
    })->toThrow(UniqueConstraintViolationException::class)
        ->and($attempts)->toBe(Codes::MAX_ATTEMPTS);
});

it('does not swallow other errors', function () {
    $attempts = 0;

    expect(function () use (&$attempts) {
        Codes::createUnique(function () use (&$attempts) {
            $attempts++;

            throw new RuntimeException('disk full');
        });
    })->toThrow(RuntimeException::class)
        ->and($attempts)->toBe(1);
});
