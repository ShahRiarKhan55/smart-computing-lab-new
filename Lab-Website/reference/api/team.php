<?php
/**
 * api/team.php
 *
 *   GET    /api/team.php                -> list all team members (public)
 *   GET    /api/team.php?id=X           -> single member (public)
 *   POST   /api/team.php                -> create (admin only)
 *   PUT    /api/team.php?id=X           -> update (admin, or the member's own linked account)
 *   DELETE /api/team.php?id=X           -> delete (admin only)
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$id = $_GET['id'] ?? null;

const CATEGORY_ORDER = ['FACULTY', 'PHD', 'MSC', 'BSC', 'RESEARCH'];

function row_to_member(array $row): array {
    return [
        'id' => $row['id'],
        'userId' => $row['user_id'],
        'name' => $row['name'],
        'initials' => $row['initials'],
        'role' => $row['role'],
        'category' => $row['category'],
        'department' => $row['department'],
        'bio' => $row['bio'],
        'photoUrl' => $row['photo_url'],
        'sortOrder' => (int) $row['sort_order'],
    ];
}

function get_member(string $id): ?array {
    $stmt = get_db()->prepare('SELECT * FROM team_members WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? row_to_member($row) : null;
}

if ($method === 'GET' && $id) {
    $member = get_member($id);
    if (!$member) json_error('Not found', 404);
    json_response($member);
}

if ($method === 'GET') {
    $rows = get_db()->query('SELECT * FROM team_members ORDER BY sort_order ASC, created_at ASC')->fetchAll();
    $members = array_map('row_to_member', $rows);
    usort($members, function ($a, $b) {
        return array_search($a['category'], CATEGORY_ORDER) <=> array_search($b['category'], CATEGORY_ORDER);
    });
    json_response($members);
}

if ($method === 'POST') {
    require_admin();
    $body = read_json_body();

    foreach (['name', 'initials', 'role', 'category'] as $field) {
        if (empty($body[$field])) {
            json_error("Missing required field: $field");
        }
    }

    $newId = uuid();
    $stmt = get_db()->prepare('
        INSERT INTO team_members (id, user_id, name, initials, role, category, department, bio, photo_url, sort_order)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        $newId,
        $body['name'],
        $body['initials'],
        $body['role'],
        $body['category'],
        $body['department'] ?? '',
        $body['bio'] ?? '',
        $body['photoUrl'] ?? '',
        $body['sortOrder'] ?? 0,
    ]);

    json_response(get_member($newId), 201);
}

if ($method === 'PUT') {
    if (!$id) json_error('Missing id');
    $user = require_login();
    $existing = get_member($id);
    if (!$existing) json_error('Not found', 404);

    $isOwner = $existing['userId'] && $existing['userId'] === $user['id'];
    if ($user['role'] !== 'ADMIN' && !$isOwner) {
        json_error('Forbidden', 403);
    }

    $body = read_json_body();

    // Non-admins cannot change their own category or sort order —
    // those stay under the admin's control even on their own profile.
    $isAdmin = $user['role'] === 'ADMIN';
    $category = $isAdmin ? ($body['category'] ?? $existing['category']) : $existing['category'];
    $sortOrder = $isAdmin ? ($body['sortOrder'] ?? $existing['sortOrder']) : $existing['sortOrder'];

    $stmt = get_db()->prepare('
        UPDATE team_members
        SET name = ?, initials = ?, role = ?, category = ?, department = ?, bio = ?, photo_url = ?, sort_order = ?
        WHERE id = ?
    ');
    $stmt->execute([
        $body['name'] ?? $existing['name'],
        $body['initials'] ?? $existing['initials'],
        $body['role'] ?? $existing['role'],
        $category,
        $body['department'] ?? $existing['department'],
        $body['bio'] ?? $existing['bio'],
        $body['photoUrl'] ?? $existing['photoUrl'],
        $sortOrder,
        $id,
    ]);

    json_response(get_member($id));
}

if ($method === 'DELETE') {
    require_admin();
    if (!$id) json_error('Missing id');
    $existing = get_member($id);
    if (!$existing) json_error('Not found', 404);

    get_db()->prepare('DELETE FROM team_members WHERE id = ?')->execute([$id]);
    json_response(['success' => true]);
}

json_error('Method not allowed', 405);
