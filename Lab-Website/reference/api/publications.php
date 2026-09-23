<?php
/**
 * api/publications.php
 *
 *   GET    /api/publications.php           -> list all (public)
 *   GET    /api/publications.php?id=X      -> single (public)
 *   POST   /api/publications.php           -> create (any logged-in member)
 *   PUT    /api/publications.php?id=X      -> update (any logged-in member)
 *   DELETE /api/publications.php?id=X      -> delete (admin only)
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$id = $_GET['id'] ?? null;

function row_to_pub(array $row): array {
    return [
        'id' => $row['id'],
        'year' => (int) $row['year'],
        'title' => $row['title'],
        'authors' => $row['authors'],
        'venue' => $row['venue'],
        'pdfUrl' => $row['pdf_url'],
        'doiUrl' => $row['doi_url'],
        'extraUrl' => $row['extra_url'],
        'extraLabel' => $row['extra_label'],
    ];
}

function get_pub(string $id): ?array {
    $stmt = get_db()->prepare('SELECT * FROM publications WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? row_to_pub($row) : null;
}

if ($method === 'GET' && $id) {
    $pub = get_pub($id);
    if (!$pub) json_error('Not found', 404);
    json_response($pub);
}

if ($method === 'GET') {
    $rows = get_db()->query('SELECT * FROM publications ORDER BY year DESC, created_at DESC')->fetchAll();
    json_response(array_map('row_to_pub', $rows));
}

if ($method === 'POST') {
    require_login();
    $body = read_json_body();

    foreach (['year', 'title', 'authors', 'venue'] as $field) {
        if (empty($body[$field])) {
            json_error("Missing required field: $field");
        }
    }

    $newId = uuid();
    $stmt = get_db()->prepare('
        INSERT INTO publications (id, year, title, authors, venue, pdf_url, doi_url, extra_url, extra_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        $newId,
        (int) $body['year'],
        $body['title'],
        $body['authors'],
        $body['venue'],
        $body['pdfUrl'] ?? '',
        $body['doiUrl'] ?? '',
        $body['extraUrl'] ?? '',
        $body['extraLabel'] ?? '',
    ]);

    json_response(get_pub($newId), 201);
}

if ($method === 'PUT') {
    require_login();
    if (!$id) json_error('Missing id');
    $existing = get_pub($id);
    if (!$existing) json_error('Not found', 404);

    $body = read_json_body();
    $stmt = get_db()->prepare('
        UPDATE publications
        SET year = ?, title = ?, authors = ?, venue = ?, pdf_url = ?, doi_url = ?, extra_url = ?, extra_label = ?
        WHERE id = ?
    ');
    $stmt->execute([
        isset($body['year']) ? (int) $body['year'] : $existing['year'],
        $body['title'] ?? $existing['title'],
        $body['authors'] ?? $existing['authors'],
        $body['venue'] ?? $existing['venue'],
        $body['pdfUrl'] ?? $existing['pdfUrl'],
        $body['doiUrl'] ?? $existing['doiUrl'],
        $body['extraUrl'] ?? $existing['extraUrl'],
        $body['extraLabel'] ?? $existing['extraLabel'],
        $id,
    ]);

    json_response(get_pub($id));
}

if ($method === 'DELETE') {
    require_admin();
    if (!$id) json_error('Missing id');
    $existing = get_pub($id);
    if (!$existing) json_error('Not found', 404);

    get_db()->prepare('DELETE FROM publications WHERE id = ?')->execute([$id]);
    json_response(['success' => true]);
}

json_error('Method not allowed', 405);
