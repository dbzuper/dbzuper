<?php

namespace Database\Factories;

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<SavedConnection> */
class SavedConnectionFactory extends Factory
{
    protected $model = SavedConnection::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => fake()->words(2, true),
            'driver' => DriverName::MySql,
            'host' => '127.0.0.1',
            'port' => 3306,
            'database' => 'app',
            'username' => 'root',
            'password' => 'secret',
            'options' => [],
            'read_only' => false,
            'store_history' => true,
        ];
    }
}
