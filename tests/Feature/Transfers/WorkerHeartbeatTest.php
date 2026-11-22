<?php

use App\Transfers\WorkerHeartbeat;
use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Event;

it('is alive only within the window', function () {
    expect(WorkerHeartbeat::alive())->toBeFalse();

    WorkerHeartbeat::beat();
    expect(WorkerHeartbeat::alive())->toBeTrue();

    $this->travel(16)->seconds();
    expect(WorkerHeartbeat::alive())->toBeFalse()
        ->and(WorkerHeartbeat::alive(30))->toBeTrue();
});

it('beats when the transfers queue loops, and only then', function () {
    Event::dispatch(new Looping('database', 'default'));
    expect(WorkerHeartbeat::alive())->toBeFalse();

    Event::dispatch(new Looping('transfers', 'transfers'));
    expect(WorkerHeartbeat::alive())->toBeTrue();
});
