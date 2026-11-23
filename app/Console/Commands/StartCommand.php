<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Process\PhpExecutableFinder;
use Symfony\Component\Process\Process;

/**
 * Serves DBZuper without Docker: the web server plus the background workers that backups and restores need, the
 * way the Docker image's entrypoint runs them. A worker that exits is started again (after 1 s, then longer, up to
 * 30 s while it keeps failing); everything stops when the web server stops or on Ctrl+C.
 */
class StartCommand extends Command
{
    protected $signature = 'dbzuper:start
        {--host=127.0.0.1 : The host address to serve the application on}
        {--port=8000 : The port to serve the application on}
        {--transfer-workers=1 : How many backups and restores can run side by side (0 for none)}';

    protected $description = 'Serve DBZuper with its background workers (for installs without Docker)';

    /** Seconds before the n-th restart in a row of a failing worker: 1, 2, 4, 8, 16, then 30. */
    protected int $maxBackoff = 30;

    /** A worker that ran at least this long before exiting is not counted as failing. */
    protected int $healthyAfter = 60;

    private bool $stopping = false;

    public function handle(): int
    {
        $this->call('dbzuper:transfers:recover');

        if (extension_loaded('pcntl')) {
            $this->trap([SIGINT, SIGTERM], function () {
                $this->stopping = true;
            });
        }

        $processes = $this->processes();
        $serverName = array_key_first($processes);
        /** @var array<string, array{process: Process, failures: int, startedAt: float, restartAt: float|null}> $running */
        $running = [];
        foreach ($processes as $name => $command) {
            $running[$name] = ['process' => $this->launch($name, $command), 'failures' => 0, 'startedAt' => microtime(true), 'restartAt' => null];
        }

        while (! $this->stopping) {
            if (! $running[$serverName]['process']->isRunning()) {
                break;
            }
            foreach ($running as $name => &$entry) {
                if ($name === $serverName) {
                    continue;
                }
                if ($entry['restartAt'] === null && ! $entry['process']->isRunning()) {
                    $entry['failures'] = microtime(true) - $entry['startedAt'] >= $this->healthyAfter ? 1 : $entry['failures'] + 1;
                    $delay = min($this->maxBackoff, 2 ** ($entry['failures'] - 1));
                    $this->components->warn("{$name} exited (code {$entry['process']->getExitCode()}); starting it again in {$delay} s.");
                    $entry['restartAt'] = microtime(true) + $delay;
                } elseif ($entry['restartAt'] !== null && microtime(true) >= $entry['restartAt']) {
                    $entry['process'] = $this->launch($name, $processes[$name]);
                    $entry['startedAt'] = microtime(true);
                    $entry['restartAt'] = null;
                }
            }
            unset($entry);
            usleep(200_000);
        }

        foreach (array_reverse($running, true) as $entry) {
            if ($entry['process']->isRunning()) {
                $entry['process']->stop(10);
            }
        }
        $code = $running[$serverName]['process']->getExitCode();

        return $this->stopping ? self::SUCCESS : (int) ($code ?? self::FAILURE);
    }

    /**
     * The processes to run, the web server first: name => command line.
     *
     * @return array<string, list<string>>
     */
    protected function processes(): array
    {
        $php = (new PhpExecutableFinder)->find(false) ?: 'php';
        $artisan = base_path('artisan');
        $processes = [
            'server' => [$php, $artisan, 'serve', '--host='.$this->option('host'), '--port='.$this->option('port')],
        ];
        $workers = max(0, (int) $this->option('transfer-workers'));
        for ($i = 1; $i <= $workers; $i++) {
            $processes[$workers === 1 ? 'transfers' : "transfers-{$i}"] = [$php, $artisan, 'queue:work', 'transfers', '--queue=transfers', '--sleep=1', '--tries=1', '--timeout=0'];
        }
        $processes['queue'] = [$php, $artisan, 'queue:work', 'database', '--queue=default', '--sleep=3', '--tries=3'];

        return $processes;
    }

    /** @param list<string> $command */
    private function launch(string $name, array $command): Process
    {
        $process = new Process($command, base_path(), null, null, null);
        $process->start(function (string $type, string $output) use ($name) {
            foreach (preg_split('/\R/', rtrim($output, "\r\n")) ?: [] as $line) {
                if (trim($line) !== '') {
                    // Raw, and to the stream itself: a process's output is never read as console markup, and its
                    // spacing is kept (Laravel's console style squeezes runs of spaces).
                    $this->output->getOutput()->writeln(sprintf('%-10s %s', $name, $line), OutputInterface::OUTPUT_RAW);
                }
            }
        });

        return $process;
    }
}
