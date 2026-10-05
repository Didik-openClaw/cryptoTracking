<?php
// Router for PHP's built-in server (`php -S … router.php`): mirrors
// public_html/.htaccess so tests can run the PHP gate and API without
// LiteSpeed/Apache.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$root = $_SERVER['DOCUMENT_ROOT'];
$raw = preg_replace('/\?.*$/', '', $_SERVER['REQUEST_URI']);
if (preg_match('#(%2e|%2f|%5c|\\\\|/\.\.?(/|$))#i', $raw)) {
    http_response_code(403);
    return true;
}
if (preg_match('#(^|/)\.(?!well-known/)#', $path) || (preg_match('#^/_dty(/|$)#', $path) && !preg_match('#^/_dty/(api|gate)\.php$#', $path))) {
    http_response_code(403);
    return true;
}
if (preg_match('#^/api(/|$)#', $path)) {
    require $root . '/_dty/api.php';
    return true;
}
if (preg_match('#^/(beli|demo|admin)(/|$)|^/favicon\.svg$#', $path)) {
    if (is_dir($root . $path) && substr($path, -1) !== '/') {
        header('Location: ' . $path . '/', true, 301);
        return true;
    }
    return false; // static file
}
require $root . '/_dty/gate.php';
return true;
