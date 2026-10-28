<?php

namespace App\Actions;

use App\Actions\Fortify\CreateNewUser;
use App\Models\User;
use App\Support\SetupCode;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;

class CreateFirstAdmin
{
    public function __construct(private CreateNewUser $creator, private SetupCode $setupCode) {}

    /**
     * Create the first (and only) administrator, atomically.
     *
     * Returns null when a user already exists or the setup lock could not be acquired.
     *
     * @param  array<string, mixed>  $input
     */
    public function handle(array $input, int $waitSeconds = 5): ?User
    {
        try {
            return Cache::lock('dbzuper:setup', 10)->block($waitSeconds, function () use ($input): ?User {
                if (User::query()->exists()) {
                    return null;
                }

                $user = $this->creator->create($input);
                $user->forceFill(['email_verified_at' => now()])->save();
                $this->setupCode->forget();

                return $user;
            });
        } catch (LockTimeoutException) {
            return null;
        }
    }
}
