<?php

namespace App\Policies;

use App\Models\SavedConnection;
use App\Models\User;

class SavedConnectionPolicy
{
    public function view(User $user, SavedConnection $connection): bool
    {
        return $user->id === $connection->user_id;
    }

    public function update(User $user, SavedConnection $connection): bool
    {
        return $user->id === $connection->user_id;
    }

    public function delete(User $user, SavedConnection $connection): bool
    {
        return $user->id === $connection->user_id;
    }
}
