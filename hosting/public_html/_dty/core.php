<?php
/**
 * Paid access for DTY Crypto Terminal on PHP shared hosting (Hostinger).
 *
 * The same model and API as server/access.ts (read that file for the design):
 * access codes sold per month, a signed 24-hour session cookie checked by the
 * gate in front of every terminal file, /api/refresh to re-check the code, and
 * the /api/* routes used by the buy page and the admin panel. The data file
 * uses the same keys as the Node version, so data can move between them.
 *
 * Private files live outside the web root, next to public_html:
 *   dty-private/admin.hash   bcrypt hash of the admin password (created over SSH)
 *   dty-private/secret.key   session signing key (created automatically)
 *   dty-private/data.json    codes, orders and sales settings
 */
declare(strict_types=1);

const DAY_MS = 86400000;
const MONTH_MS = 30 * DAY_MS;
const SESSION_MS = DAY_MS;
const SESSION_COOKIE = 'dty_s';
const DEVICE_COOKIE = 'dty_d';
const BUY_PATH = '/beli/';
const DEVICE_COOKIE_DAYS = 400;
const MAX_OPEN_ORDERS = 500;
const MAX_BODY = 65536;
/** Failed admin logins allowed per IP within ADMIN_WINDOW_MS. */
const ADMIN_MAX_FAILS = 10;
const ADMIN_WINDOW_MS = 15 * 60000;
/** No 0/O or 1/I; 32 symbols so random bytes map without bias. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_CONFIG = [
    'price' => 500000,
    'normalPrice' => 0,
    'promoEnd' => 0,
    'whatsapp' => '',
    'paymentInfo' => '',
    'maxDevices' => 2,
    'packages' => [1, 3, 6, 12],
];

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function private_dir(): string
{
    $env = getenv('DTY_PRIVATE_DIR');
    return is_string($env) && $env !== '' ? rtrim($env, '/') : dirname(__DIR__, 2) . '/dty-private';
}

function ensure_private_dir(): bool
{
    $dir = private_dir();
    return is_dir($dir) || @mkdir($dir, 0700, true);
}

/** Session signing key, generated on first use. Empty string if the private folder is not writable. */
function session_secret(): string
{
    $file = private_dir() . '/secret.key';
    $s = @file_get_contents($file);
    if (is_string($s) && strlen(trim($s)) >= 32) return trim($s);
    if (!ensure_private_dir()) return '';
    $fh = @fopen($file, 'c+');
    if (!$fh) return '';
    flock($fh, LOCK_EX);
    $cur = trim((string) stream_get_contents($fh));
    if (strlen($cur) < 32) {
        $cur = bin2hex(random_bytes(32));
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $cur);
        fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    @chmod($file, 0600);
    return $cur;
}

function admin_hash(): string
{
    $h = @file_get_contents(private_dir() . '/admin.hash');
    return is_string($h) ? trim($h) : '';
}

// ---------- store: one JSON file, locked for each request ----------

final class Store
{
    /** @var resource */
    private $lock;
    private string $file;
    private array $data = [];
    private bool $dirty = false;

    private function __construct($lock, string $file)
    {
        $this->lock = $lock;
        $this->file = $file;
        $raw = @file_get_contents($file);
        $data = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
        $this->data = is_array($data) ? $data : [];
    }

    /** Opens the data file; $write takes an exclusive lock for the whole request. */
    public static function open(bool $write): ?Store
    {
        if (!ensure_private_dir()) return null;
        $lock = @fopen(private_dir() . '/data.lock', 'c');
        if (!$lock) return null;
        flock($lock, $write ? LOCK_EX : LOCK_SH);
        return new Store($lock, private_dir() . '/data.json');
    }

    public function get(string $key): ?array
    {
        return isset($this->data[$key]) && is_array($this->data[$key]) ? $this->data[$key] : null;
    }

    public function set(string $key, array $value): void
    {
        $this->data[$key] = $value;
        $this->dirty = true;
    }

    public function delete(string $key): void
    {
        unset($this->data[$key]);
        $this->dirty = true;
    }

    /** @return array[] values whose key starts with $prefix */
    public function values(string $prefix): array
    {
        $out = [];
        foreach ($this->data as $k => $v) {
            if (strncmp((string) $k, $prefix, strlen($prefix)) === 0 && is_array($v)) $out[] = $v;
        }
        return $out;
    }

    /** Writes changes atomically (temp file + rename) and releases the lock. */
    public function close(): void
    {
        if ($this->dirty) {
            $tmp = $this->file . '.tmp';
            $json = json_encode((object) $this->data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            if ($json !== false && @file_put_contents($tmp, $json) !== false) {
                @chmod($tmp, 0600);
                rename($tmp, $this->file);
            }
            $this->dirty = false;
        }
        flock($this->lock, LOCK_UN);
        fclose($this->lock);
    }
}

// ---------- helpers ----------

function random_string(int $n): string
{
    $s = '';
    foreach (str_split(random_bytes($n)) as $b) $s .= ALPHABET[ord($b) % 32];
    return $s;
}

function new_code(): string
{
    $r = random_string(12);
    return 'DTY-' . substr($r, 0, 4) . '-' . substr($r, 4, 4) . '-' . substr($r, 8);
}

/** Accept codes typed with or without dashes, spaces, lower case or the DTY prefix. */
function normalize_code(string $input): ?string
{
    $s = preg_replace('/[^0-9A-Z]/', '', strtoupper($input));
    $body = strncmp($s, 'DTY', 3) === 0 ? substr($s, 3) : $s;
    if (strlen($body) !== 12 || strspn($body, ALPHABET) !== 12) return null;
    return 'DTY-' . substr($body, 0, 4) . '-' . substr($body, 4, 4) . '-' . substr($body, 8);
}

/** Indonesian phone numbers to wa.me format: 0812… / +62 812… / 812… → 62812… */
function normalize_phone(string $input): string
{
    $d = preg_replace('/\D/', '', $input);
    if (strncmp($d, '0', 1) === 0) $d = '62' . substr($d, 1);
    elseif (strncmp($d, '8', 1) === 0) $d = '62' . $d;
    $len = strlen($d);
    return $len >= 9 && $len <= 15 ? $d : '';
}

function mask_code(string $code): string
{
    return 'DTY-****-****-' . substr($code, -4);
}

function code_status(array $r, int $now): string
{
    return !empty($r['revoked']) ? 'dicabut' : ((int) $r['exp'] <= $now ? 'habis' : 'aktif');
}

function b64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function b64url_decode(string $s): string
{
    $d = base64_decode(strtr($s, '-_', '+/'), true);
    return $d === false ? '' : $d;
}

function hmac(string $secret, string $data): string
{
    return b64url(hash_hmac('sha256', $data, $secret, true));
}

function text_field($v, int $max): string
{
    $s = is_scalar($v) ? trim((string) $v) : '';
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}

function text_length(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
}

function read_months($v, ?array $allowed = null): ?int
{
    if (!is_numeric($v)) return null;
    $m = (int) round((float) $v);
    if ($m < 1 || $m > 36) return null;
    return $allowed !== null && !in_array($m, $allowed, true) ? null : $m;
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

function request_path(): string
{
    $p = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    return is_string($p) ? $p : '/';
}

function is_document_request(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET'
        && (($_SERVER['HTTP_SEC_FETCH_DEST'] ?? '') === 'document' || strpos($_SERVER['HTTP_ACCEPT'] ?? '', 'text/html') !== false);
}

// ---------- responses ----------

function cookie_header(string $name, string $value, int $maxAgeMs, bool $secure): string
{
    $parts = [$name . '=' . $value, 'Path=/', 'Max-Age=' . max(0, intdiv($maxAgeMs, 1000)), 'SameSite=Lax', 'HttpOnly'];
    if ($secure) $parts[] = 'Secure';
    return implode('; ', $parts);
}

function send_headers(int $status, array $headers, array $cookies = []): void
{
    http_response_code($status);
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    foreach ($headers as $k => $v) header($k . ': ' . $v);
    foreach ($cookies as $c) header('Set-Cookie: ' . $c, false);
}

function send_json($body, int $status = 200, array $cookies = []): void
{
    send_headers($status, ['Content-Type' => 'application/json; charset=utf-8'], $cookies);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function send_redirect(string $location, array $cookies = []): void
{
    send_headers(302, ['Location' => $location], $cookies);
}

function send_text(int $status, string $text): void
{
    send_headers($status, ['Content-Type' => 'text/plain; charset=utf-8']);
    echo $text;
}

function not_configured(string $what = ''): void
{
    send_text(
        503,
        $what !== ''
            ? $what
            : 'Server belum dikonfigurasi: folder dty-private di samping public_html tidak bisa dibuat atau ditulis. Lihat hosting/README.md.',
    );
}

/** Only same-site relative paths, to avoid an open redirect through ?next=. */
function safe_next(?string $next): string
{
    return is_string($next) && strncmp($next, '/', 1) === 0 && strncmp($next, '//', 2) !== 0 ? $next : '/';
}

// ---------- sessions ----------

function sign_session(array $s, string $secret): string
{
    $body = b64url(json_encode($s, JSON_UNESCAPED_SLASHES));
    return $body . '.' . hmac($secret, $body);
}

/** Verifies the signature; returns the payload even when its exp has passed. */
function read_session(?string $value, string $secret): ?array
{
    if (!is_string($value) || $value === '' || $secret === '') return null;
    $parts = explode('.', $value);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return null;
    if (!hash_equals(hmac($secret, $parts[0]), $parts[1])) return null;
    $s = json_decode(b64url_decode($parts[0]), true);
    return is_array($s) && is_string($s['c'] ?? null) && is_string($s['d'] ?? null) && is_int($s['exp'] ?? null) ? $s : null;
}

function session_cookie_for(array $record, string $device, string $secret, int $now, bool $secure): string
{
    $exp = (int) $record['exp'];
    $session = ['c' => $record['code'], 'd' => $device, 'exp' => min($now + SESSION_MS, $exp), 'until' => $exp];
    return cookie_header(SESSION_COOKIE, sign_session($session, $secret), $exp - $now, $secure);
}

function clear_session(bool $secure): string
{
    return cookie_header(SESSION_COOKIE, '', 0, $secure);
}

/** @return array{0: ?array, 1: string} [record, reason] — record is null when the session is not backed by a live code */
function check_session(array $s, Store $store, int $now): array
{
    $r = $store->get('code/' . $s['c']);
    if (!$r) return [null, 'invalid'];
    if (!empty($r['revoked'])) return [null, 'revoked'];
    if ((int) $r['exp'] <= $now) return [null, 'expired'];
    if (!in_array($s['d'], $r['devices'] ?? [], true)) return [null, 'device'];
    return [$r, ''];
}

function get_config(Store $store): array
{
    return array_merge(DEFAULT_CONFIG, $store->get('config') ?? []);
}

function by_created_desc(array $a, array $b): int
{
    return ($b['createdAt'] ?? 0) <=> ($a['createdAt'] ?? 0);
}

function with_status(array $r, int $now): array
{
    $r['status'] = code_status($r, $now);
    return $r;
}

function read_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (!is_string($raw) || $raw === '' || strlen($raw) > MAX_BODY) return [];
    $b = json_decode($raw, true);
    return is_array($b) ? $b : [];
}

// ---------- API ----------

/** Handles every /api/* request (see server/access.ts handleApi). */
function handle_api(): void
{
    $secret = session_secret();
    if ($secret === '') {
        not_configured();
        return;
    }
    $now = now_ms();
    $secure = is_https();
    $path = trim(preg_replace('#^/api/?#', '', request_path()), '/');
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) {
        send_text(413, 'Permintaan terlalu besar');
        return;
    }

    $admin = strncmp($path, 'admin', 5) === 0;
    $store = Store::open($admin || $method !== 'GET');
    if (!$store) {
        not_configured();
        return;
    }
    try {
        if ($admin) handle_admin($store, trim(substr($path, 5), '/'), $method, $now, $secret);
        else handle_public($store, $path, $method, $now, $secret, $secure);
    } finally {
        $store->close();
    }
}

function handle_public(Store $store, string $path, string $method, int $now, string $secret, bool $secure): void
{
    if ($path === 'config' && $method === 'GET') {
        send_json(get_config($store) + ['serverTime' => $now]);
        return;
    }

    if ($path === 'order' && $method === 'POST') {
        $b = read_body();
        $c = get_config($store);
        $name = text_field($b['name'] ?? '', 60);
        $contact = normalize_phone(is_scalar($b['contact'] ?? null) ? (string) $b['contact'] : '');
        $months = read_months($b['months'] ?? null, $c['packages']);
        if (text_length($name) < 2) {
            send_json(['error' => 'name', 'message' => 'Isi nama Anda.'], 400);
            return;
        }
        if ($contact === '') {
            send_json(['error' => 'contact', 'message' => 'Nomor WhatsApp tidak valid.'], 400);
            return;
        }
        if (!$months) {
            send_json(['error' => 'months', 'message' => 'Pilih paket yang tersedia.'], 400);
            return;
        }
        $open = array_filter($store->values('order/'), fn ($o) => ($o['status'] ?? '') === 'baru');
        if (count($open) >= MAX_OPEN_ORDERS) {
            send_json(['error' => 'busy', 'message' => 'Pesanan sedang penuh, hubungi admin via WhatsApp.'], 429);
            return;
        }
        $order = [
            'id' => random_string(6),
            'name' => $name,
            'contact' => $contact,
            'months' => $months,
            'total' => $months * (int) $c['price'],
            'createdAt' => $now,
            'status' => 'baru',
        ];
        $store->set('order/' . $order['id'], $order);
        send_json(['id' => $order['id'], 'total' => $order['total']]);
        return;
    }

    if ($path === 'login' && $method === 'POST') {
        $b = read_body();
        $code = normalize_code(is_scalar($b['code'] ?? null) ? (string) $b['code'] : '');
        if (!$code) {
            send_json(['error' => 'invalid', 'message' => 'Format kode tidak dikenal. Contoh: DTY-AB12-CD34-EF56.'], 400);
            return;
        }
        $record = $store->get('code/' . $code);
        if (!$record) {
            send_json(['error' => 'invalid', 'message' => 'Kode akses tidak ditemukan.'], 404);
            return;
        }
        $status = code_status($record, $now);
        if ($status === 'dicabut') {
            send_json(['error' => 'revoked', 'message' => 'Kode ini sudah dinonaktifkan. Hubungi admin.'], 403);
            return;
        }
        if ($status === 'habis') {
            send_json(['error' => 'expired', 'message' => 'Masa akses kode ini sudah habis. Perpanjang via WhatsApp.'], 403);
            return;
        }
        $c = get_config($store);
        $cookieDevice = $_COOKIE[DEVICE_COOKIE] ?? '';
        $device = is_string($cookieDevice) && preg_match('/^[0-9A-Z]{16}$/', $cookieDevice) ? $cookieDevice : random_string(16);
        $devices = $record['devices'] ?? [];
        if (!in_array($device, $devices, true)) {
            if (count($devices) >= (int) $c['maxDevices']) {
                send_json([
                    'error' => 'device_limit',
                    'message' => 'Kode ini sudah dipakai di ' . $c['maxDevices'] . ' perangkat. Keluar dari perangkat lama atau minta admin mereset perangkat.',
                ], 403);
                return;
            }
            $devices[] = $device;
            $record['devices'] = $devices;
            $record['log'][] = ['at' => $now, 'action' => 'perangkat baru'];
            $store->set('code/' . $code, $record);
        }
        send_json(['ok' => true, 'name' => $record['name'], 'exp' => $record['exp']], 200, [
            session_cookie_for($record, $device, $secret, $now, $secure),
            cookie_header(DEVICE_COOKIE, $device, DEVICE_COOKIE_DAYS * DAY_MS, $secure),
        ]);
        return;
    }

    if ($path === 'logout' && $method === 'POST') {
        $s = read_session($_COOKIE[SESSION_COOKIE] ?? null, $secret);
        if ($s) {
            // Free the device slot so the buyer can move to another device.
            $record = $store->get('code/' . $s['c']);
            if ($record && in_array($s['d'], $record['devices'] ?? [], true)) {
                $record['devices'] = array_values(array_filter($record['devices'], fn ($d) => $d !== $s['d']));
                $record['log'][] = ['at' => $now, 'action' => 'keluar'];
                $store->set('code/' . $s['c'], $record);
            }
        }
        send_json(['ok' => true], 200, [clear_session($secure)]);
        return;
    }

    if (($path === 'me' || $path === 'refresh') && $method === 'GET') {
        $s = read_session($_COOKIE[SESSION_COOKIE] ?? null, $secret);
        [$record, $reason] = $s ? check_session($s, $store, $now) : [null, 'invalid'];
        if ($path === 'refresh') {
            if (!$record) send_redirect(BUY_PATH . '?alasan=' . $reason, [clear_session($secure)]);
            else send_redirect(safe_next($_GET['next'] ?? null), [session_cookie_for($record, $s['d'], $secret, $now, $secure)]);
            return;
        }
        if (!$record) {
            send_json(['error' => $reason], 401, $s ? [clear_session($secure)] : []);
            return;
        }
        $c = get_config($store);
        send_json([
            'name' => $record['name'],
            'exp' => $record['exp'],
            'code' => mask_code($record['code']),
            'devicesUsed' => count($record['devices'] ?? []),
            'maxDevices' => $c['maxDevices'],
            'serverTime' => $now,
        ], 200, [session_cookie_for($record, $s['d'], $secret, $now, $secure)]);
        return;
    }

    send_json(['error' => 'not_found'], 404);
}

/** The admin password from the Authorization header (some hosts move it) or X-Admin-Key. */
function admin_credential(): string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, 'Authorization') === 0) $h = $v;
    }
    $given = preg_replace('/^Bearer\s+/i', '', (string) $h);
    return $given !== '' ? $given : (string) ($_SERVER['HTTP_X_ADMIN_KEY'] ?? '');
}

function handle_admin(Store $store, string $path, string $method, int $now, string $secret): void
{
    $hash = admin_hash();
    if ($hash === '') {
        not_configured('Password admin belum dibuat. Jalankan perintah "password admin" di hosting/README.md lewat SSH.');
        return;
    }
    $ipKey = 'throttle/' . substr(hash('sha256', $secret . ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 16);
    $t = $store->get($ipKey);
    if ($t && $now - (int) $t['since'] < ADMIN_WINDOW_MS && (int) $t['n'] >= ADMIN_MAX_FAILS) {
        send_json(['error' => 'busy', 'message' => 'Terlalu banyak percobaan password. Coba lagi 15 menit lagi.'], 429);
        return;
    }
    $given = admin_credential();
    if ($given === '' || !password_verify($given, $hash)) {
        $fresh = !$t || $now - (int) $t['since'] >= ADMIN_WINDOW_MS;
        $store->set($ipKey, ['n' => $fresh ? 1 : (int) $t['n'] + 1, 'since' => $fresh ? $now : (int) $t['since']]);
        send_json(['error' => 'unauthorized', 'message' => 'Password admin salah.'], 401);
        return;
    }
    if ($t) $store->delete($ipKey);

    $parts = array_map('rawurldecode', $path === '' ? [] : explode('/', $path));
    $section = $parts[0] ?? '';
    $id = $parts[1] ?? '';
    $action = $parts[2] ?? '';

    if ($section === 'config') {
        if ($method === 'GET') {
            send_json(get_config($store));
            return;
        }
        if ($method === 'PUT') {
            $b = read_body();
            $cur = get_config($store);
            $int = fn ($v) => is_numeric($v) ? (int) round((float) $v) : 0;
            $next = [
                'price' => array_key_exists('price', $b) ? max(0, $int($b['price'])) : $cur['price'],
                'normalPrice' => array_key_exists('normalPrice', $b) ? max(0, $int($b['normalPrice'])) : $cur['normalPrice'],
                'promoEnd' => array_key_exists('promoEnd', $b) ? max(0, $int($b['promoEnd'])) : $cur['promoEnd'],
                'whatsapp' => array_key_exists('whatsapp', $b) ? normalize_phone(is_scalar($b['whatsapp']) ? (string) $b['whatsapp'] : '') : $cur['whatsapp'],
                'paymentInfo' => array_key_exists('paymentInfo', $b) ? text_field($b['paymentInfo'], 1500) : $cur['paymentInfo'],
                'maxDevices' => array_key_exists('maxDevices', $b) ? min(10, max(1, $int($b['maxDevices']) ?: 1)) : $cur['maxDevices'],
                'packages' => $cur['packages'],
            ];
            if (isset($b['packages']) && is_array($b['packages'])) {
                $p = array_values(array_unique(array_filter(array_map(fn ($m) => read_months($m), $b['packages']))));
                sort($p);
                $next['packages'] = $p ?: DEFAULT_CONFIG['packages'];
            }
            $store->set('config', $next);
            send_json($next);
            return;
        }
    }

    if ($section === 'orders') {
        if ($id === '' && $method === 'GET') {
            $orders = $store->values('order/');
            usort($orders, 'by_created_desc');
            send_json($orders);
            return;
        }
        $order = $id !== '' ? $store->get('order/' . $id) : null;
        if (!$order) {
            send_json(['error' => 'not_found'], 404);
            return;
        }
        if ($method === 'DELETE' && $action === '') {
            $store->delete('order/' . $id);
            send_json(['ok' => true]);
            return;
        }
        if ($method === 'POST' && $action === 'status') {
            $status = (string) (read_body()['status'] ?? '');
            if (!in_array($status, ['baru', 'selesai', 'batal'], true)) {
                send_json(['error' => 'status'], 400);
                return;
            }
            $order['status'] = $status;
            $store->set('order/' . $id, $order);
            send_json($order);
            return;
        }
    }

    if ($section === 'codes') {
        if ($id === '' && $method === 'GET') {
            $codes = $store->values('code/');
            usort($codes, 'by_created_desc');
            send_json(array_map(fn ($c) => with_status($c, $now), $codes));
            return;
        }
        if ($id === '' && $method === 'POST') {
            $b = read_body();
            $name = text_field($b['name'] ?? '', 60);
            $months = read_months($b['months'] ?? null);
            if (text_length($name) < 2) {
                send_json(['error' => 'name', 'message' => 'Isi nama pembeli.'], 400);
                return;
            }
            if (!$months) {
                send_json(['error' => 'months', 'message' => 'Jumlah bulan 1–36.'], 400);
                return;
            }
            do {
                $code = new_code();
            } while ($store->get('code/' . $code));
            $orderId = text_field($b['orderId'] ?? '', 12);
            $record = [
                'code' => $code,
                'name' => $name,
                'contact' => normalize_phone(is_scalar($b['contact'] ?? null) ? (string) $b['contact'] : ''),
                'note' => text_field($b['note'] ?? '', 200),
                'months' => $months,
                'createdAt' => $now,
                'exp' => $now + $months * MONTH_MS,
                'revoked' => false,
                'devices' => [],
            ];
            if ($orderId !== '') $record['orderId'] = $orderId;
            $record['log'] = [['at' => $now, 'action' => 'dibuat', 'months' => $months]];
            $store->set('code/' . $code, $record);
            if ($orderId !== '' && ($order = $store->get('order/' . $orderId))) {
                $order['status'] = 'selesai';
                $order['code'] = $code;
                $store->set('order/' . $orderId, $order);
            }
            send_json(with_status($record, $now), 201);
            return;
        }
        $code = $id !== '' ? normalize_code($id) : null;
        $record = $code ? $store->get('code/' . $code) : null;
        if (!$code || !$record) {
            send_json(['error' => 'not_found'], 404);
            return;
        }
        if ($method === 'DELETE' && $action === '') {
            $store->delete('code/' . $code);
            send_json(['ok' => true]);
            return;
        }
        if ($method === 'POST') {
            if ($action === 'extend') {
                $months = read_months(read_body()['months'] ?? null);
                if (!$months) {
                    send_json(['error' => 'months', 'message' => 'Jumlah bulan 1–36.'], 400);
                    return;
                }
                $record['exp'] = max((int) $record['exp'], $now) + $months * MONTH_MS;
                $record['months'] = (int) $record['months'] + $months;
                $record['log'][] = ['at' => $now, 'action' => 'diperpanjang', 'months' => $months];
            } elseif ($action === 'revoke') {
                $record['revoked'] = true;
                $record['log'][] = ['at' => $now, 'action' => 'dicabut'];
            } elseif ($action === 'restore') {
                $record['revoked'] = false;
                $record['log'][] = ['at' => $now, 'action' => 'dipulihkan'];
            } elseif ($action === 'reset-devices') {
                $record['devices'] = [];
                $record['log'][] = ['at' => $now, 'action' => 'reset perangkat'];
            } else {
                send_json(['error' => 'not_found'], 404);
                return;
            }
            $store->set('code/' . $code, $record);
            send_json(with_status($record, $now));
            return;
        }
    }

    send_json(['error' => 'not_found'], 404);
}

// ---------- gate + static files ----------

const MIME = [
    'html' => 'text/html; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'svg' => 'image/svg+xml',
    'png' => 'image/png',
    'ico' => 'image/x-icon',
    'woff2' => 'font/woff2',
    'txt' => 'text/plain; charset=utf-8',
];

/**
 * Decoded, normalized URL path, or null for anything suspicious. The gate and
 * the file lookup both use this one value, so encoded tricks such as
 * "/beli/..%2fassets/x.js" are judged as the protected "/assets/x.js".
 */
function clean_path(string $raw): ?string
{
    $p = rawurldecode($raw);
    if (strpos($p, "\0") !== false || strpos($p, '\\') !== false) return null;
    $out = [];
    foreach (explode('/', $p) as $seg) {
        if ($seg === '' || $seg === '.') continue;
        if ($seg === '..') {
            array_pop($out);
            continue;
        }
        $out[] = $seg;
    }
    $clean = '/' . implode('/', $out);
    return substr($p, -1) === '/' && $clean !== '/' ? $clean . '/' : $clean;
}

/** Runs in front of every terminal file: a valid, unexpired session cookie or no file. */
function handle_gate(): void
{
    $path = clean_path(request_path());
    if ($path === null) {
        send_text(400, 'Alamat tidak valid');
        return;
    }
    $secret = session_secret();
    if ($secret === '') {
        not_configured();
        return;
    }
    $s = read_session($_COOKIE[SESSION_COOKIE] ?? null, $secret);
    if (!$s || $s['exp'] <= now_ms()) {
        if (!is_document_request()) {
            send_text(401, 'Akses diperlukan');
            return;
        }
        $qs = $_SERVER['QUERY_STRING'] ?? '';
        if ($s) send_redirect('/api/refresh?next=' . rawurlencode($path . ($qs !== '' ? '?' . $qs : '')));
        else send_redirect(BUY_PATH);
        return;
    }
    serve_file($path);
}

function serve_file(string $path): void
{
    $root = dirname(__DIR__);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && $method !== 'HEAD') {
        send_text(405, 'Metode tidak didukung');
        return;
    }
    // Never serve hidden files, PHP, or this folder.
    if (preg_match('#(^|/)\.|\.php$|^/_dty(/|$)#i', $path)) {
        send_text(404, 'Not found');
        return;
    }
    $file = $root . $path;
    if (is_dir($file)) {
        if (substr($path, -1) !== '/') {
            send_headers(301, ['Location' => $path . '/']);
            return;
        }
        $file .= 'index.html';
    }
    $real = realpath($file);
    if ($real === false || strncmp($real, realpath($root) . '/', strlen(realpath($root)) + 1) !== 0 || !is_file($real)) {
        send_text(404, 'Not found');
        return;
    }
    $ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
    $mtime = (int) filemtime($real);
    http_response_code(200);
    header('Content-Type: ' . (MIME[$ext] ?? 'application/octet-stream'));
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Vary: Accept-Encoding');
    if ($ext === 'html') {
        header('Cache-Control: private, no-store');
    } elseif (strpos($path, '/assets/') !== false) {
        // Content-hashed names; useless without the gated HTML.
        header('Cache-Control: private, max-age=31536000, immutable');
    } else {
        header('Cache-Control: private, max-age=0, must-revalidate');
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
        $since = strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '');
        if ($since !== false && $since >= $mtime) {
            http_response_code(304);
            return;
        }
    }
    // Pre-compressed copy made by scripts/package-hosting.mjs.
    $gz = $real . '.gz';
    if (strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false && is_file($gz) && filemtime($gz) >= $mtime) {
        header('Content-Encoding: gzip');
        $real = $gz;
    }
    header('Content-Length: ' . filesize($real));
    if ($method === 'HEAD') return;
    readfile($real);
}
