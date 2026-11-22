<?php

namespace App\Transfers;

use App\Enums\TransferDirection;
use App\Enums\TransferMethod;
use App\Enums\TransferStatus;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Creates transfers, allowing one active transfer per database. */
class TransferStarter
{
    /**
     * @param  array<string, mixed>  $options
     *
     * @throws TransferConflict
     */
    public static function start(
        SavedConnection $connection,
        User $user,
        TransferDirection $direction,
        TransferMethod $method,
        array $options,
        string $fileName,
        ?int $bytesTotal,
        TransferStatus $initial = TransferStatus::Pending,
    ): Transfer {
        TransferStorage::prune();

        $active = array_values(array_filter(TransferStatus::cases(), fn (TransferStatus $s) => $s->isActive()));

        return DB::transaction(function () use ($connection, $user, $direction, $method, $options, $fileName, $bytesTotal, $initial, $active) {
            $existing = Transfer::query()
                ->where('saved_connection_id', $connection->getKey())
                ->where('database', $connection->storageDatabase())
                ->whereIn('status', array_map(fn (TransferStatus $s) => $s->value, $active))
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                throw new TransferConflict($existing->direction === TransferDirection::Export
                    ? 'A backup of this database is already running'
                    : 'A restore of this database is already running');
            }

            return Transfer::create([
                'user_id' => $user->getKey(),
                'saved_connection_id' => $connection->getKey(),
                'database' => $connection->storageDatabase(),
                'direction' => $direction,
                'method' => $method,
                'options' => $options,
                'status' => $initial,
                'bytes_total' => $bytesTotal,
                'file_name' => $fileName,
            ]);
        });
    }
}
