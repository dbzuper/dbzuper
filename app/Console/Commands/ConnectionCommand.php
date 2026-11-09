<?php

namespace App\Console\Commands;

use App\Http\Requests\ConnectionRequest;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

class ConnectionCommand extends Command
{
    protected $signature = 'dbzuper:connection
        {name : Name shown in DBZuper}
        {--driver= : mysql, mariadb, pgsql or sqlite}
        {--host=127.0.0.1 : Server host (server drivers)}
        {--port= : Server port (default: the driver\'s)}
        {--username= : Server user (server drivers)}
        {--password= : Server password; leave out for none}
        {--database= : One database, or blank to browse every database on the server; the file path for sqlite}
        {--read-only : Have the database refuse writes on this connection}
        {--user= : Email of the account that owns it (default: the administrator)}
        {--if-missing : Do nothing when the account already has a connection with this name}';

    protected $description = 'Add a saved connection from the command line, validated like the connection form';

    public function handle(): int
    {
        $user = $this->option('user')
            ? User::query()->where('email', $this->option('user'))->first()
            : User::query()->orderBy('id')->first();
        if ($user === null) {
            $this->error($this->option('user')
                ? "No account with the email {$this->option('user')}."
                : 'No account exists yet: create the administrator first (dbzuper:install).');

            return self::FAILURE;
        }

        $name = (string) $this->argument('name');
        if ($this->option('if-missing') && $user->connections()->where('name', $name)->exists()) {
            $this->info("{$name} already exists; left as it is.");

            return self::SUCCESS;
        }

        // The form's own request: the same rules (DSN safety, SQLite path policy) and the same attributes.
        $input = array_filter([
            'name' => $name,
            'driver' => $this->option('driver'),
            'host' => $this->option('host'),
            'port' => $this->option('port'),
            'username' => $this->option('username'),
            'password' => $this->option('password'),
            'database' => $this->option('database'),
            'read_only' => $this->option('read-only'),
            'store_history' => true,
        ], fn ($v) => $v !== null && $v !== '' && $v !== false);
        $request = ConnectionRequest::create('/connections', 'POST', $input);
        $request->setContainer(app())->setRedirector(app('redirect'));
        $request->setUserResolver(fn () => $user);

        try {
            $request->validateResolved();
        } catch (ValidationException $e) {
            foreach ($e->errors() as $messages) {
                foreach ($messages as $message) {
                    $this->error($message);
                }
            }

            return self::FAILURE;
        }

        $user->connections()->create($request->connectionAttributes());
        $this->info("Added the connection {$name}.");

        return self::SUCCESS;
    }
}
