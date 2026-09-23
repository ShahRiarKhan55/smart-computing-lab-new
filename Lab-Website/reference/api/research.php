<?php
/**
 * api/research.php
 *
 *   GET    /api/research.php           -> list all (public)
 *   GET    /api/research.php?id=X      -> single (public)
 *   POST   /api/research.php           -> create (any logged-in member)
 *   PUT    /api/research.php?id=X      -> update (any logged-in member)
 *   DELETE /api/research.php?id=X      -> delete (admin only)
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$id = $_GET['id'] ?? null;

function row_to_area(array $row): array {
    return [
        'id' => $row['id'],
        'icon' => $row['icon'],
        'title' => $row['title'],
        'description' => $row['description'],
        'tag' => $row['tag'],
        'sortOrder' => (int) $row['sort_order'],
    ];
}

function get_area(string $id): ?array {
    $stmt = get_db()->prepare('SELECT * FROM research_areas WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? row_to_area($row) : null;
}

if ($method === 'GET' && $id) {
    $area = get_area($id);
    if (!$area) json_error('Not found', 404);
    json_response($area);
}

if ($method === 'GET') {
    $rows = get_db()->query('SELECT * FROM research_areas ORDER BY sort_order ASC, created_at ASC')->fetchAll();
    json_response(array_map('row_to_area', $rows));
}

if ($method === 'POST') {
    require_login();
    $body = read_json_body();

    foreach (['title', 'description', 'tag'] as $field) {
        if (empty($body[$field])) {
            json_error("Missing required field: $field");
        }
    }

    $newId = uuid();
    $stmt = get_db()->prepare('
        INSERT INTO research_areas (id, icon, title, description, tag, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        $newId,
        $body['icon'] ?? '🔬',
        $body['title'],
        $body['description'],
        $body['tag'],
        $body['sortOrder'] ?? 0,
    ]);

    json_response(get_area($newId), 201);
}

if ($method === 'PUT') {
    require_login();
    if (!$id) json_error('Missing id');
    $existing = get_area($id);
    if (!$existing) json_error('Not found', 404);

    $body = read_json_body();
    $stmt = get_db()->prepare('
        UPDATE research_areas
        SET icon = ?, title = ?, description = ?, tag = ?, sort_order = ?
        WHERE id = ?
    ');
    $stmt->execute([
        $body['icon'] ?? $existing['icon'],
        $body['title'] ?? $existing['title'],
        $body['description'] ?? $existing['description'],
        $body['tag'] ?? $existing['tag'],
        $body['sortOrder'] ?? $existing['sortOrder'],
        $id,
    ]);

    json_response(get_area($id));
}

if ($method === 'DELETE') {
    require_admin();
    if (!$id) json_error('Missing id');
    $existing = get_area($id);
    if (!$existing) json_error('Not found', 404);

    get_db()->prepare('DELETE FROM research_areas WHERE id = ?')->execute([$id]);
    json_response(['success' => true]);
}

json_error('Method not allowed', 405);
