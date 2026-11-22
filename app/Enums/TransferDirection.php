<?php

namespace App\Enums;

enum TransferDirection: string
{
    case Export = 'export';
    case Import = 'import';
}
