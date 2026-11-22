<?php

namespace App\Enums;

enum TransferMethod: string
{
    case Native = 'native';
    case Builtin = 'builtin';
}
