<?php
/**
 * api/profile.php
 *
 *   GET /api/profile.php  -> the logged-in user's own team profile
 *   PUT /api/profile.php  -> update own profile (name/role/dept/bio/photo only;
 *                            category & sortOrder stay admin-controlled)
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$user = require_login();

function row_to_member_profile(array $row): array {
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

function get_member_by_user(string $userId): ?array {
    $stmt = get_db()->prepare('SELECT * FROM team_members WHERE user_id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return $row ? row_to_member_profile($row) : null;
}

$member = get_member_by_user($user['id']);

if ($method === 'GET') {
    if (!$member) {
        json_error('No team profile is linked to your account yet. Ask the admin to link one.', 404);
    }
    json_response($member);
}

if ($method === 'PUT') {
    if (!$member) {
        json_error('No team profile is linked to your account yet. Ask the admin to link one.', 404);
    }

    $body = read_json_body();
    $stmt = get_db()->prepare('
        UPDATE team_members
        SET name = ?, initials = ?, role = ?, department = ?, bio = ?, photo_url = ?
        WHERE id = ?
    ');
    $stmt->execute([
        $body['name'] ?? $member['name'],
        $body['initials'] ?? $member['initials'],
        $body['role'] ?? $member['role'],
        $body['department'] ?? $member['department'],
        $body['bio'] ?? $member['bio'],
        $body['photoUrl'] ?? $member['photoUrl'],
        $member['id'],
    ]);

    json_response(get_member_by_user($user['id']));
}

json_error('Method not allowed', 405);
