<?php

namespace Tests\Support;

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Native\NativeExporter;
use App\Transfers\Native\ToolCheck;
use App\Transfers\TransferPlanner;
use Mockery;

final class FakePlanner
{
    /**
     * The real planner, except that its tool check finds $tool, and its server version is $version (no server needed
     * except for MySQL/MariaDB native gaps); bound in the container.
     */
    public static function bind(ToolCheck $tool, string $version = ''): TransferPlanner
    {
        $planner = Mockery::mock(TransferPlanner::class, [
            app(ConnectionFactory::class), app(DriverRegistry::class), app(DbErrorMapper::class),
            app(BuiltinExporters::class), app(NativeExporter::class),
        ])->makePartial()->shouldAllowMockingProtectedMethods();
        $planner->shouldReceive('check')->andReturn($tool);
        $planner->shouldReceive('serverVersion')->andReturn($version);
        app()->instance(TransferPlanner::class, $planner);

        return $planner;
    }
}
