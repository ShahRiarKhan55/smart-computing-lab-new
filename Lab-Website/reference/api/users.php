<?php
/**
 * api/users.php
 *
 *   GET    /api/users.php          -> list all accounts (admin only)
 *   PUT    /api/users.php?id=X     -> change a user's role (admin only)
 *   DELETE /api/users.php?id=X     -> delete an account (admin only, not yourself)
 *   POST   /api/users.php          -> create a new login for a lab member (admin only)
 *       body: { email, password, role, teamMemberId? }
 *          OR { email, password, role, name, initials, memberRole, category } to
 *             create a brand new team profile at the same time
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$id = $_GET['id'] ?? null;

if ($method === 'GET') {
    require_admin();

    $rows = get_db()->query('SELECT id, email, role, created_at FROM users ORDER BY created_at ASC')->fetchAll();

    $memberStmt = get_db()->prepare('SELECT id, name FROM team_members WHERE user_id = ?');

    $users = array_map(function ($row) use ($memberStmt) {
        $memberStmt->execute([$row['id']]);
        $member = $memberStmt->fetch();
        return [
            'id' => $row['id'],
            'email' => $row['email'],
            'role' => $row['role'],
            'createdAt' => $row['created_at'],
            'teamMemberName' => $member ? $member['name'] : null,
            'teamMemberId' => $member ? $member['id'] : null,
        ];
    }, $rows);

    json_response($users);
}

if ($method === 'POST') {
    require_admin();
    $body = read_json_body();

    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';
    $role = ($body['role'] ?? 'MEMBER') === 'ADMIN' ? 'ADMIN' : 'MEMBER';

    if ($email === '' || $password === '') {
        json_error('Email and password are required.');
    }
    if (strlen($password) < 8) {
        json_error('Password must be at least 8 characters.');
    }

    $db = get_db();
    $existsStmt = $db->prepare('SELECT id FROM users WHERE email = ?');
    $existsStmt->execute([strtolower($email)]);
    if ($existsStmt->fetch()) {
        json_error('An account with that email already exists.', 409);
    }

    $newUserId = uuid();
    $hash = password_hash($password, PASSWORD_DEFAULT);

    $db->prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
        ->execute([$newUserId, strtolower($email), $hash, $role]);

    // Link to an existing team member, or create a brand new one.
    if (!empty($body['teamMemberId'])) {
        $db->prepare('UPDATE team_members SET user_id = ? WHERE id = ?')
            ->execute([$newUserId, $body['teamMemberId']]);
    } elseif (!empty($body['name']) && !empty($body['initials']) && !empty($body['memberRole']) && !empty($body['category'])) {
        $db->prepare('
            INSERT INTO team_members (id, user_id, name, initials, role, category, department, bio, photo_url, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ')->execute([
            uuid(),
            $newUserId,
            $body['name'],
            $body['initials'],
            $body['memberRole'],
            $body['category'],
            '',
            '',
            '',
            0,
        ]);
    }

    json_response(['id' => $newUserId, 'email' => strtolower($email), 'role' => $role], 201);
}

if ($method === 'PUT') {
    require_admin();
    if (!$id) json_error('Missing id');

    $body = read_json_body();
    $role = $body['role'] ?? '';
    if ($role !== 'ADMIN' && $role !== 'MEMBER') {
        json_error('Role must be ADMIN or MEMBER');
    }

    $db = get_db();
    $existsStmt = $db->prepare('SELECT id FROM users WHERE id = ?');
    $existsStmt->execute([$id]);
    if (!$existsStmt->fetch()) {
        json_error('Not found', 404);
    }

    $db->prepare('UPDATE users SET role = ? WHERE id = ?')->execute([$role, $id]);
    json_response(['success' => true]);
}

if ($method === 'DELETE') {
    $admin = require_admin();
    if (!$id) json_error('Missing id');

    if ($id === $admin['id']) {
        json_error("You can't delete your own account.");
    }

    $db = get_db();
    $existsStmt = $db->prepare('SELECT id FROM users WHERE id = ?');
    $existsStmt->execute([$id]);
    if (!$existsStmt->fetch()) {
        json_error('Not found', 404);
    }

    $db->prepare('UPDATE team_members SET user_id = NULL WHERE user_id = ?')->execute([$id]);
    $db->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);

    json_response(['success' => true]);
}

json_error('Method not allowed', 405);
