<?php

namespace App\Database\Contracts;

use App\Database\Schema\SchemaSnapshot;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;

interface SchemaInspector
{
    public function inspect(Connection $db, SavedConnection $saved): SchemaSnapshot;
}
