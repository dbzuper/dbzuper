<?php

namespace App\Console\Commands;

use App\Actions\Fortify\CreateNewUser;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;

use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

class InstallCommand extends Command
{
    protected $signature = 'dbsuperb:install {--name=} {--email=} {--password=}';

    protected $description = 'Create the DBSuperb administrator account';

    public function handle(CreateNewUser $creator): int
    {
        if (User::query()->exists()) {
            $this->error('DBSuperb is already installed: an administrator exists.');

            return self::FAILURE;
        }

        $name = $this->option('name') ?? text('Name', required: true);
        $email = $this->option('email') ?? text('Email', required: true);
        $password = $this->option('password') ?? password('Password', required: true);

        try {
            $user = $creator->create([
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

        $user->forceFill(['email_verified_at' => now()])->save();
        $this->info("Administrator {$user->email} created.");

        return self::SUCCESS;
    }
}
