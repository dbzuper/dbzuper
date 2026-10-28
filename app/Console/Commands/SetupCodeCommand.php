<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\SetupCode;
use Illuminate\Console\Command;

class SetupCodeCommand extends Command
{
    protected $signature = 'dbzuper:setup-code';

    protected $description = 'Show the one-time code the setup screen asks for';

    public function handle(SetupCode $setupCode): int
    {
        if (User::query()->exists()) {
            $setupCode->forget();
            $this->line('Setup is complete: an administrator exists. Sign in at '.$this->appUrl('/login').'.');

            return self::SUCCESS;
        }

        $this->line('Open '.$this->appUrl('/setup').' and enter the setup code '.$setupCode->current());

        return self::SUCCESS;
    }

    /** APP_URL is the address people open; url() in the console only knows the boot-time root. */
    private function appUrl(string $path): string
    {
        return rtrim((string) config('app.url'), '/').$path;
    }
}
