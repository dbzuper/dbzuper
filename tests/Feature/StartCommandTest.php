<?php

use App\Console\Commands\StartCommand;
use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;
use Symfony\Component\Process\PhpExecutableFinder;

/**
 * Runs dbzuper:start with the given processes (name => PHP code, the server first) instead of the real ones.
 *
 * @param  array<string, string>  $code
 * @return array{0: int, 1: string}
 */
function runStart(array $code, int $maxBackoff = 30): array
{
    $php = (new PhpExecutableFinder)->find(false) ?: 'php';
    $command = new class($code, $php, $maxBackoff) extends StartCommand
    {
        /** @param array<string, string> $code */
        public function __construct(private array $code, private string $php, int $maxBackoff)
        {
            parent::__construct();
            $this->maxBackoff = $maxBackoff;
        }

        protected function processes(): array
        {
            return array_map(fn (string $c) => [$this->php, '-r', $c], $this->code);
        }
    };
    app(Kernel::class)->registerCommand($command);
    $out = new BufferedOutput;
    $exit = Artisan::call('dbzuper:start', [], $out);

    return [$exit, $out->fetch()];
}

function startTempFile(): string
{
    $path = tempnam(sys_get_temp_dir(), 'dbzstart');
    file_put_contents($path, '');

    return $path;
}

it('runs the processes, labels their output, and stops the workers when the server exits', function () {
    $ticks = startTempFile();
    [$exit, $output] = runStart([
        'server' => 'echo "  INFO listening\n"; usleep(1500000); exit(3);',
        'transfers' => 'while (true) { file_put_contents('.var_export($ticks, true).', "x", FILE_APPEND); usleep(100000); }',
    ]);

    expect($exit)->toBe(3)
        // The name padded to 10, then the process's line as it was (leading spaces kept).
        ->and($output)->toContain('server       INFO listening')
        ->and(strlen((string) file_get_contents($ticks)))->toBeGreaterThan(3);
    $size = filesize($ticks);
    usleep(600000);
    clearstatcache();
    expect(filesize($ticks))->toBe($size); // the worker was stopped with the server
    unlink($ticks);
});

it('starts a worker again after it exits', function () {
    $starts = startTempFile();
    [$exit, $output] = runStart([
        'server' => 'usleep(2600000);',
        'transfers' => 'file_put_contents('.var_export($starts, true).', "x", FILE_APPEND); exit(1);',
    ], maxBackoff: 1);

    expect($exit)->toBe(0)
        ->and(strlen((string) file_get_contents($starts)))->toBeGreaterThanOrEqual(2)
        ->and($output)->toContain('transfers exited (code 1); starting it again in 1 s.');
    unlink($starts);
});

it('marks interrupted transfers as failed before starting the workers', function () {
    $connection = SavedConnection::factory()->create();
    $t = Transfer::create([
        'user_id' => $connection->user_id,
        'saved_connection_id' => $connection->id,
        'database' => '',
        'direction' => TransferDirection::Export,
        'method' => TransferMethod::Builtin,
        'options' => [],
        'file_name' => 'dump.sql',
        'status' => TransferStatus::Running,
    ]);
    $t->forceFill(['worker_host' => gethostname(), 'worker_pid' => 4242])->save();

    [, $output] = runStart(['server' => 'exit(0);']);

    expect($t->fresh()?->status)->toBe(TransferStatus::Failed)
        ->and($output)->toContain('Marked 1 interrupted backup or restore as failed.');
});

it('serves with one transfer worker and the default queue unless told otherwise', function () {
    $command = new class extends StartCommand
    {
        /** @return array<string, list<string>> */
        public function list(): array
        {
            return $this->processes();
        }
    };
    $command->setLaravel(app());
    $command->setInput(new ArrayInput(['--transfer-workers' => '2', '--port' => '8123'], $command->getDefinition()));

    $list = $command->list();

    expect(array_keys($list))->toBe(['server', 'transfers-1', 'transfers-2', 'queue'])
        ->and(array_slice($list['server'], 2))->toBe(['serve', '--host=127.0.0.1', '--port=8123'])
        ->and(array_slice($list['transfers-1'], 2))->toBe(['queue:work', 'transfers', '--queue=transfers', '--sleep=1', '--tries=1', '--timeout=0'])
        ->and(array_slice($list['queue'], 2))->toBe(['queue:work', 'database', '--queue=default', '--sleep=3', '--tries=3']);
});
