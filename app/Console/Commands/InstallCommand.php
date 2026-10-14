<?php

namespace App\Console\Commands;

use App\Actions\CreateFirstAdmin;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

class InstallCommand extends Command
{
    protected $signature = 'dbsuperb:install {--name=} {--email=} {--password=}';

    protected $description = 'Create the DBSuperb administrator account';

    public function handle(CreateFirstAdmin $createFirstAdmin): int
    {
        if (User::query()->exists()) {
            return $this->alreadyInstalled();
        }

        $name = $this->option('name') ?? text('Name', required: true);
        $email = $this->option('email') ?? text('Email', required: true);
        $password = $this->option('password') ?? password('Password', required: true);

        try {
            $user = $createFirstAdmin->handle([
                'name' => $name, 'email' => $email,
                'password' => $password, 'password_confirmation' => $password,
            ]);
        } catch (ValidationException $e) {
            foreach ($e->errors() as $messages) {
                foreach ($messages as $message) {
                    $this->error($message);
                }
            }

            return self::FAILURE;
        }

        if ($user === null) {
            return $this->alreadyInstalled();
        }

        $this->info("Administrator {$user->email} created.");

        return self::SUCCESS;
    }

    private function alreadyInstalled(): int
    {
        $this->error('DBSuperb is already installed: an administrator exists.');

        return self::FAILURE;
    }
}
