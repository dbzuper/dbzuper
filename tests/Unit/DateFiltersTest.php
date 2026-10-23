<?php

use App\Database\Query\DateFilters;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

uses(TestCase::class);

const DATE_FILTER_COLUMNS = [
    ['name' => 'd', 'type_name' => 'date'],
    ['name' => 'ts', 'type_name' => 'datetime'],
    ['name' => 'name', 'type_name' => 'varchar'],
];

/** @return array<string, list<string>> the validation errors, or [] when the filters pass */
function dateFilterErrors(array $filters): array
{
    try {
        DateFilters::validate($filters, DATE_FILTER_COLUMNS);
    } catch (ValidationException $e) {
        return $e->errors();
    }

    return [];
}

it('adds calendar days across month, year and leap-day boundaries', function (string $date, int $days, string $expected) {
    expect(DateFilters::addDays($date, $days))->toBe($expected);
})->with([
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-03-01', -1, '2026-02-28'],
]);

it('tells date-only values from timed ones', function () {
    expect(DateFilters::isDateOnly('2026-10-01'))->toBeTrue()
        ->and(DateFilters::isDateOnly('2026-10-01 10:00:00'))->toBeFalse();
});

it('accepts valid date filters and leaves other operators alone', function (array $filter) {
    expect(dateFilterErrors([$filter]))->toBe([]);
})->with([
    'on a date' => [['column' => 'd', 'op' => 'on', 'value' => '2026-10-01']],
    'on a datetime' => [['column' => 'ts', 'op' => 'on', 'value' => '2026-10-01']],
    'between dates' => [['column' => 'd', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-31']],
    'between timed' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01 10:00:00', 'to' => '2026-10-01 10:00:00.5']],
    'between mixed' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-15 23:59:58']],
    'after timed' => [['column' => 'ts', 'op' => 'after', 'value' => '2026-10-01 10:00:00.123456']],
    'leap day' => [['column' => 'd', 'op' => 'on', 'value' => '2028-02-29']],
    'timed start within a date-only end day' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15 10:00:00', 'to' => '2026-10-15']],
    'equal fractions of different widths' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15 10:00:00.5', 'to' => '2026-10-15 10:00:00.50']],
    'equal fractions, wider first' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15 10:00:00.50', 'to' => '2026-10-15 10:00:00.5']],
    'one-instant range' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15 10:00:00', 'to' => '2026-10-15 10:00:00']],
    'one-day range' => [['column' => 'd', 'op' => 'between', 'value' => '2026-10-15', 'to' => '2026-10-15']],
    'eq on text' => [['column' => 'name', 'op' => 'eq', 'value' => 'x', 'to' => null]],
    'after the last second of 9999' => [['column' => 'ts', 'op' => 'after', 'value' => '9999-12-31 23:59:58']],
    'range to a timed end in 9999-12-31' => [['column' => 'ts', 'op' => 'between', 'value' => '9999-12-31', 'to' => '9999-12-31 23:59:59']],
    'lt on 9999-12-31' => [['column' => 'ts', 'op' => 'lt', 'value' => '9999-12-31']],
]);

it('rejects a date-only 9999-12-31 where the filter needs the day after', function (array $filter, string $key) {
    expect(dateFilterErrors([$filter]))->toBe([$key => ['That date is too late to filter by.']]);
})->with([
    'on, datetime' => [['column' => 'ts', 'op' => 'on', 'value' => '9999-12-31'], 'filters.0.value'],
    'on, date' => [['column' => 'd', 'op' => 'on', 'value' => '9999-12-31'], 'filters.0.value'],
    'after, date' => [['column' => 'd', 'op' => 'after', 'value' => '9999-12-31'], 'filters.0.value'],
    'after, datetime' => [['column' => 'ts', 'op' => 'after', 'value' => '9999-12-31'], 'filters.0.value'],
    'between date-only end, datetime' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01', 'to' => '9999-12-31'], 'filters.0.to'],
    'between date-only end, date' => [['column' => 'd', 'op' => 'between', 'value' => '2026-10-01', 'to' => '9999-12-31'], 'filters.0.to'],
]);

it('rejects invalid date filters with a keyed message', function (array $filter, string $key, ?string $message = null) {
    $errors = dateFilterErrors([['column' => 'ts', 'op' => 'eq', 'value' => '1'], $filter]);

    expect($errors)->toHaveKey($key);
    if ($message !== null) {
        expect($errors[$key])->toBe([$message]);
    }
})->with([
    'on with a time' => [['column' => 'ts', 'op' => 'on', 'value' => '2026-10-01 10:00:00'], 'filters.1.value'],
    'between without to' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01'], 'filters.1.to'],
    'reversed range' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15', 'to' => '2026-10-01'], 'filters.1.to', 'The range ends before it starts.'],
    'date start after a timed end' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15', 'to' => '2026-10-14 23:59:59'], 'filters.1.to', 'The range ends before it starts.'],
    'date start after a date end' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-16', 'to' => '2026-10-15'], 'filters.1.to', 'The range ends before it starts.'],
    'larger fraction first' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15 10:00:00.5', 'to' => '2026-10-15 10:00:00.49'], 'filters.1.to', 'The range ends before it starts.'],
    'timed start after a date-only end day' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-16 00:00:00', 'to' => '2026-10-15'], 'filters.1.to', 'The range ends before it starts.'],
    'text column' => [['column' => 'name', 'op' => 'on', 'value' => '2026-10-01'], 'filters.1.op', 'Date operators need a date column.'],
    'after timed on a date column' => [['column' => 'd', 'op' => 'after', 'value' => '2026-10-01 10:00:00'], 'filters.1.value'],
    'between timed on a date column' => [['column' => 'd', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-02 10:00:00'], 'filters.1.to'],
    'missing value' => [['column' => 'ts', 'op' => 'after', 'value' => null], 'filters.1.value'],
    'February 30' => [['column' => 'ts', 'op' => 'on', 'value' => '2026-02-30'], 'filters.1.value'],
    'month 13' => [['column' => 'ts', 'op' => 'on', 'value' => '2026-13-01'], 'filters.1.value'],
    'hour 24' => [['column' => 'ts', 'op' => 'after', 'value' => '2026-10-01 24:00:00'], 'filters.1.value'],
    'T separator' => [['column' => 'ts', 'op' => 'after', 'value' => '2026-10-01T10:00:00'], 'filters.1.value'],
    'zone suffix' => [['column' => 'ts', 'op' => 'after', 'value' => '2026-10-01 10:00:00Z'], 'filters.1.value'],
    'invalid to' => [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-02-30'], 'filters.1.to'],
    'to on eq' => [['column' => 'ts', 'op' => 'eq', 'value' => '2026-10-01', 'to' => '2026-10-02'], 'filters.1.to'],
]);
