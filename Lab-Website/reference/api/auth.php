<?php
/**
 * api/auth.php
 *
 * Handles:
 *   POST /api/auth.php?action=login    { email, password }
 *   POST /api/auth.php?action=logout
 *   GET  /api/auth.php?action=me        -> current logged-in user, or null
 */

require_once __DIR__ . '/config.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

if ($action === 'me' && $method === 'GET') {
    json_response(['user' => current_user()]);
}

if ($action === 'login' && $method === 'POST') {
    $body = read_json_body();
    $email = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';

    if ($email === '' || $password === '') {
        json_error('Email and password are required.');
    }

    $stmt = get_db()->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([strtolower($email)]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        json_error('Incorrect email or password.', 401);
    }

    // Regenerate session id on login to prevent session fixation.
    session_regenerate_id(true);
    $_SESSION['user_id'] = $user['id'];

    json_response([
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'role' => $user['role'],
        ],
    ]);
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = [];
    session_destroy();
    json_response(['success' => true]);
}

json_error('Unknown action.', 404);
