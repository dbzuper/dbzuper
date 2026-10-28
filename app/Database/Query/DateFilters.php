<?php

namespace App\Database\Query;

use App\Database\DateKind;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Validation and calendar arithmetic for the date operators (on, between, after). Values arrive in canonical form
 * only: `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM:SS` with up to six fractional digits. They are compared exactly as
 * stored: there is no time-zone conversion anywhere.
 */
final class DateFilters
{
    public const OPS = ['on', 'between', 'after'];

    /** The last day a filter can name where it needs the day after (a date-only end, `on`, `after`). */
    private const LAST_DAY = '9999-12-31';

    private const TOO_LATE = 'That date is too late to filter by.';

    private const CANONICAL = '/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?)?$/';

    /**
     * @param  list<array{column: string, op: string, value?: ?string, to?: ?string}>  $filters
     * @param  list<array{name: string, type_name?: ?string}>  $columns  the table's columns
     *
     * @throws ValidationException keyed filters.{i}.op / filters.{i}.value / filters.{i}.to
     */
    public static function validate(array $filters, array $columns): void
    {
        $types = array_column($columns, 'type_name', 'name');
        $errors = [];
        foreach ($filters as $i => $f) {
            $error = function (string $field, string $message) use (&$errors, $i): void {
                $errors["filters.{$i}.{$field}"] = $message;
            };
            $value = $f['value'] ?? null;
            $to = $f['to'] ?? null;
            if (! in_array($f['op'], self::OPS, true)) {
                if ($to !== null) {
                    $error('to', 'Only a range takes an end date.');
                }

                continue;
            }
            $kind = DateKind::classify((string) ($types[$f['column']] ?? ''));
            if ($kind === null) {
                $error('op', 'Date operators need a date column.');

                continue;
            }

            $valueOk = self::checkValue($value, $kind, $f['op'] === 'on', $error, 'value');
            // `on` and a date-only `after` compare against the next day, which 9999-12-31 does not have.
            if ($valueOk && $f['op'] !== 'between' && $value === self::LAST_DAY) {
                $error('value', self::TOO_LATE);
            }
            if ($f['op'] !== 'between') {
                if ($to !== null) {
                    $error('to', 'Only a range takes an end date.');
                }

                continue;
            }
            if (! self::checkValue($to, $kind, false, $error, 'to')) {
                continue;
            }
            // A date-only end means its whole day, up to the next one; 9999-12-31 has none.
            if ($to === self::LAST_DAY) {
                $error('to', self::TOO_LATE);
            } elseif ($valueOk && ! self::inOrder($value, $to)) {
                $error('to', 'The range ends before it starts.');
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /** Records an error for a missing, malformed or (where a date is needed) timed value; says whether it passed. */
    private static function checkValue(?string $value, DateKind $kind, bool $dateOnly, callable $error, string $field): bool
    {
        $message = match (true) {
            $value === null => 'Enter a date.',
            ! self::isValid($value) => 'Enter a real date as YYYY-MM-DD or YYYY-MM-DD HH:MM:SS.',
            $dateOnly && ! self::isDateOnly($value) => 'Enter a date without a time.',
            $kind === DateKind::Date && ! self::isDateOnly($value) => 'This column holds dates without a time.',
            default => null,
        };
        if ($message !== null) {
            $error($field, $message);
        }

        return $message === null;
    }

    /**
     * Whether the range selects anything: the start comes before the effective end. A date-only end means its whole
     * day (start < end+1), a timed end is inclusive (start <= end).
     */
    private static function inOrder(string $start, string $end): bool
    {
        return self::isDateOnly($end)
            ? self::instant($start) < self::instant(self::addDays($end, 1))
            : self::instant($start) <= self::instant($end);
    }

    /**
     * A valid canonical value as a fixed-width string that compares in time order: a date-only value reads as its
     * day's 00:00, and the fraction is padded to six digits so .5 and .50 compare equal.
     */
    private static function instant(string $value): string
    {
        [$seconds, $fraction] = array_pad(explode('.', $value, 2), 2, '');

        return (self::isDateOnly($seconds) ? $seconds.' 00:00:00' : $seconds).'.'.str_pad($fraction, 6, '0');
    }

    /** Whether the value is in canonical form and names a real calendar date and time of day. */
    private static function isValid(string $value): bool
    {
        if (! preg_match(self::CANONICAL, $value, $m)) {
            return false;
        }
        $text = $m[1].' '.($m[2] ?? '00:00:00');
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $text, new DateTimeZone('UTC'));

        // Overflowing fields (Feb 30, month 13, hour 24) parse, but roll over: they don't round-trip.
        return $parsed !== false && $parsed->format('Y-m-d H:i:s') === $text;
    }

    public static function isDateOnly(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value);
    }

    /** Calendar-day arithmetic on the date part of a canonical value; returns a date-only value. */
    public static function addDays(string $date, int $days): string
    {
        $day = DateTimeImmutable::createFromFormat('!Y-m-d', substr($date, 0, 10), new DateTimeZone('UTC'));
        if ($day === false) {
            throw new InvalidArgumentException("Not a date: {$date}.");
        }

        return $day->modify(sprintf('%+d days', $days))->format('Y-m-d');
    }
}
