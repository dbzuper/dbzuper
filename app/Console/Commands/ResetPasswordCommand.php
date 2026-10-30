<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;

use function Laravel\Prompts\password;

class ResetPasswordCommand extends Command
{
    protected $signature = 'dbzuper:reset-password {email? : The account to reset, optional when there is only one} {--password=} {--reset-2fa : Also turn off two-factor authentication and remove passkeys}';

    protected $description = 'Set a new password for an account that cannot sign in';

    public function handle(DisableTwoFactorAuthentication $disableTwoFactor): int
    {
        $user = $this->findUser();

        if ($user === null) {
            return self::FAILURE;
        }

        $password = $this->option('password') ?? $this->askPassword();

        if ($password === null) {
            return self::FAILURE;
        }

        $validator = Validator::make(['password' => $password], ['password' => ['required', 'string', Password::default()]]);

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }

            return self::FAILURE;
        }

        $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
        $this->signOutEverywhere($user);
        $this->info("Password for {$user->email} changed. Signed out of every browser.");

        if ($this->option('reset-2fa')) {
            $disableTwoFactor($user);
            $user->passkeys()->delete();
            $this->info('Two-factor authentication turned off and passkeys removed: set them up again under Settings → Security.');
        }

        return self::SUCCESS;
    }

    private function findUser(): ?User
    {
        $email = $this->argument('email');

        if ($email !== null) {
            $user = User::query()->where('email', $email)->first();

            if ($user === null) {
                $this->error("No account uses {$email}.");
            }

            return $user;
        }

        if (User::query()->count() === 1) {
            return User::query()->sole();
        }

        $this->error(User::query()->exists()
            ? 'More than one account exists: pass the email of the one to reset.'
            : 'No account exists yet: open /setup to create the administrator.');

        return null;
    }

    private function askPassword(): ?string
    {
        $password = password('New password', required: true);

        if (password('Confirm the new password', required: true) !== $password) {
            $this->error('The passwords do not match.');

            return null;
        }

        return $password;
    }

    /** Database sessions record their user, so they can be ended here; the new remember token ends "remember me". */
    private function signOutEverywhere(User $user): void
    {
        if (config('session.driver') === 'database') {
            DB::connection(config('session.connection'))
                ->table(config('session.table', 'sessions'))
                ->where('user_id', $user->getKey())
                ->delete();
        }
    }
}
