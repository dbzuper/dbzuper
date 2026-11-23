<?php

use App\Support\BrowserTimezone;

it('keeps a name PHP knows', function (string $zone) {
    expect(BrowserTimezone::resolve($zone))->toBe($zone);
})->with(['Asia/Kuala_Lumpur', 'Asia/Kolkata', 'UTC', 'America/Argentina/Buenos_Aires']);

it('maps a legacy name to one PHP knows with the same time', function (string $legacy, string $current) {
    $resolved = BrowserTimezone::resolve($legacy);
    if ($resolved === null) {
        $this->markTestSkipped("This PHP knows no {$legacy} and has no intl (ICU 74+) to map it");
    }

    // The name itself where PHP's database still has it (Windows, the bundled one), else ICU's current name.
    expect($resolved)->toBeIn([$legacy, $current])
        ->and((new DateTimeZone($resolved))->getOffset(new DateTimeImmutable('2026-11-23 22:30:05 UTC')))
        ->toBe((new DateTimeZone($current))->getOffset(new DateTimeImmutable('2026-11-23 22:30:05 UTC')));
})->with([['Asia/Calcutta', 'Asia/Kolkata'], ['Asia/Saigon', 'Asia/Ho_Chi_Minh'], ['US/Eastern', 'America/New_York']]);

it('rejects anything that is not a zone name', function (mixed $zone) {
    expect(BrowserTimezone::resolve($zone))->toBeNull();
})->with(['garbage' => 'Mars/Olympus', 'an offset' => '+05:30', 'empty' => '', 'a number' => 5, 'null' => null, 'an array' => [['x']]]);
