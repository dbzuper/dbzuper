<?php

namespace App\Database\Editing;

use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * How rows of a table are pinned for editing, shared by the rows and change-set endpoints so both always agree.
 * Resolving runs a few catalogue queries (tens of milliseconds on MySQL/MariaDB), so the plan is cached per
 * snapshot: a schema refresh stores a new snapshot and so a new plan. Connection settings (read-only, schema) are
 * part of the key. A plan that can't be resolved leaves the table read-only for this request and isn't cached.
 */
final class EditPlanCache
{
    public function __construct(private readonly EditMethodResolver $resolver) {}

    public function for(SavedConnection $connection, StoredSnapshot $snapshot, array $table, Connection $db): EditPlan
    {
        $key = 'edit-plan:'.$connection->id.':'.$snapshot->id.':'.sha1(json_encode([$table['name'], $connection->read_only, $connection->options, $connection->updated_at?->toIso8601String()]));
        $cached = Cache::get($key);
        if (is_array($cached)) {
            return EditPlan::fromArray($cached);
        }

        try {
            $plan = $this->resolver->resolve($connection, $table, $db);
        } catch (Throwable $e) {
            report($e);

            return EditPlan::none('the database did not say how to identify rows');
        }
        Cache::put($key, $plan->toArray(), now()->addDay());

        return $plan;
    }
}
