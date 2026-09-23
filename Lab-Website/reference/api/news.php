<?php
/**
 * api/news.php
 *
 *   GET    /api/news.php           -> list all (public)
 *   GET    /api/news.php?id=X      -> single (public)
 *   POST   /api/news.php           -> create (any logged-in member)
 *   PUT    /api/news.php?id=X      -> update (any logged-in member)
 *   DELETE /api/news.php?id=X      -> delete (admin only)
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$id = $_GET['id'] ?? null;

function row_to_news(array $row): array {
    return [
        'id' => $row['id'],
        'date' => $row['date_label'],
        'sortDate' => $row['sort_date'],
        'type' => $row['type'],
        'emoji' => $row['emoji'],
        'title' => $row['title'],
        'description' => $row['description'],
    ];
}

function get_news_item(string $id): ?array {
    $stmt = get_db()->prepare('SELECT * FROM news_items WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? row_to_news($row) : null;
}

if ($method === 'GET' && $id) {
    $item = get_news_item($id);
    if (!$item) json_error('Not found', 404);
    json_response($item);
}

if ($method === 'GET') {
    $rows = get_db()->query('SELECT * FROM news_items ORDER BY sort_date DESC')->fetchAll();
    json_response(array_map('row_to_news', $rows));
}

if ($method === 'POST') {
    require_login();
    $body = read_json_body();

    foreach (['date', 'sortDate', 'type', 'title', 'description'] as $field) {
        if (empty($body[$field])) {
            json_error("Missing required field: $field");
        }
    }

    $newId = uuid();
    $stmt = get_db()->prepare('
        INSERT INTO news_items (id, date_label, sort_date, type, emoji, title, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        $newId,
        $body['date'],
        $body['sortDate'],
        $body['type'],
        $body['emoji'] ?? '📣',
        $body['title'],
        $body['description'],
    ]);

    json_response(get_news_item($newId), 201);
}

if ($method === 'PUT') {
    require_login();
    if (!$id) json_error('Missing id');
    $existing = get_news_item($id);
    if (!$existing) json_error('Not found', 404);

    $body = read_json_body();
    $stmt = get_db()->prepare('
        UPDATE news_items
        SET date_label = ?, sort_date = ?, type = ?, emoji = ?, title = ?, description = ?
        WHERE id = ?
    ');
    $stmt->execute([
        $body['date'] ?? $existing['date'],
        $body['sortDate'] ?? $existing['sortDate'],
        $body['type'] ?? $existing['type'],
        $body['emoji'] ?? $existing['emoji'],
        $body['title'] ?? $existing['title'],
        $body['description'] ?? $existing['description'],
        $id,
    ]);

    json_response(get_news_item($id));
}

if ($method === 'DELETE') {
    require_admin();
    if (!$id) json_error('Missing id');
    $existing = get_news_item($id);
    if (!$existing) json_error('Not found', 404);

    get_db()->prepare('DELETE FROM news_items WHERE id = ?')->execute([$id]);
    json_response(['success' => true]);
}

json_error('Method not allowed', 405);
