<?php
/**
 * config.php
 *
 * Database connection + schema setup for the Smart Computing Lab site.
 * Uses SQLite — a single file database, zero setup required on any
 * host that has PHP with the pdo_sqlite extension (almost all do).
 *
 * Every other PHP file includes this one first.
 */

// Show errors while developing; once live on a real host you may want
// to set display_errors=0 in php.ini instead of editing this file.
error_reporting(E_ALL);
ini_set('display_errors', '1');

// Sessions are how we track "who is logged in" between page loads.
session_start();

define('DB_PATH', __DIR__ . '/../data/scl.sqlite');

function get_db(): PDO {
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $isNew = !file_exists(DB_PATH);

    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON;');

    init_schema($pdo);

    return $pdo;
}

function init_schema(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'MEMBER', -- 'ADMIN' | 'MEMBER'
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS team_members (
            id          TEXT PRIMARY KEY,
            user_id     TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
            name        TEXT NOT NULL,
            initials    TEXT NOT NULL,
            role        TEXT NOT NULL,
            category    TEXT NOT NULL, -- 'FACULTY' | 'PHD' | 'MSC' | 'BSC' | 'RESEARCH'
            department  TEXT NOT NULL DEFAULT '',
            bio         TEXT NOT NULL DEFAULT '',
            photo_url   TEXT NOT NULL DEFAULT '',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS publications (
            id          TEXT PRIMARY KEY,
            year        INTEGER NOT NULL,
            title       TEXT NOT NULL,
            authors     TEXT NOT NULL,
            venue       TEXT NOT NULL,
            pdf_url     TEXT NOT NULL DEFAULT '',
            doi_url     TEXT NOT NULL DEFAULT '',
            extra_url   TEXT NOT NULL DEFAULT '',
            extra_label TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS news_items (
            id          TEXT PRIMARY KEY,
            date_label  TEXT NOT NULL,
            sort_date   TEXT NOT NULL,
            type        TEXT NOT NULL,
            emoji       TEXT NOT NULL DEFAULT '📣',
            title       TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS research_areas (
            id          TEXT PRIMARY KEY,
            icon        TEXT NOT NULL DEFAULT '🔬',
            title       TEXT NOT NULL,
            description TEXT NOT NULL,
            tag         TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS history_entries (
            id             TEXT PRIMARY KEY,
            team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
            year           TEXT NOT NULL,
            title          TEXT NOT NULL,
            description    TEXT NOT NULL DEFAULT '',
            sort_order     INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS publication_authors (
            publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
            team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
            PRIMARY KEY (publication_id, team_member_id)
        );

        CREATE TABLE IF NOT EXISTS news_authors (
            news_item_id   TEXT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
            team_member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
            PRIMARY KEY (news_item_id, team_member_id)
        );
    ");
}

function uuid(): string {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

// ---------------------------------------------------------------
// Small helpers shared by all api/*.php endpoints
// ---------------------------------------------------------------
function json_response($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function json_error(string $message, int $status = 400): void {
    json_response(['error' => $message], $status);
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function current_user(): ?array {
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = get_db()->prepare('SELECT id, email, role FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function require_login(): array {
    $user = current_user();
    if (!$user) {
        json_error('Unauthorized', 401);
    }
    return $user;
}

function require_admin(): array {
    $user = require_login();
    if ($user['role'] !== 'ADMIN') {
        json_error('Forbidden', 403);
    }
    return $user;
}

/**
 * Checks that the logged-in user is either an admin, or the account
 * linked to the given team_member_id. Used to gate edits to a specific
 * member's history, publication links, and news links.
 */
function require_owner_or_admin(string $teamMemberId): array {
    $user = require_login();
    if ($user['role'] === 'ADMIN') {
        return $user;
    }

    $stmt = get_db()->prepare('SELECT user_id FROM team_members WHERE id = ?');
    $stmt->execute([$teamMemberId]);
    $row = $stmt->fetch();

    if (!$row || $row['user_id'] !== $user['id']) {
        json_error('Forbidden', 403);
    }

    return $user;
}
