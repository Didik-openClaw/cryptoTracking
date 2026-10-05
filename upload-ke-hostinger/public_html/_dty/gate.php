<?php
// Serves terminal files only to visitors with a valid access session (routed here by .htaccess).
declare(strict_types=1);
require __DIR__ . '/core.php';
handle_gate();
