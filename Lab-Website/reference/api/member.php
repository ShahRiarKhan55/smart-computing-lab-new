<?php
/**
 * api/member.php
 *
 *   GET    /api/member.php?id=X
 *       -> full public profile: member info + history entries +
 *          linked publications + linked news items
 *
 *   POST   /api/member.php?id=X&action=add_history
 *       body: { year, title, description }
 *       -> add a history/timeline entry (owner or admin)
 *
 *   PUT    /api/member.php?id=X&action=update_history&entryId=Y
 *       body: { year, title, description }
 *       -> edit a history entry (owner or admin)
 *
 *   DELETE /api/member.php?id=X&action=delete_history&entryId=Y
 *       -> delete a history entry (owner or admin)
 *
 *   PUT    /api/member.php?id=X&action=set_publications
 *       body: { publicationIds: [id, id, ...] }
 *       -> replace the full set of publications linked to this member
 *          (owner or admin)
 *
 *   PUT    /api/member.php?id=X&action=set_news
 *       body: { newsIds: [id, id, ...] }
 *       -> replace the full set of news items linked to this member
 *          (owner or admin)
 */

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$id = $_GET['id'] ?? null;
$action = $_GET['action'] ?? null;

if (!$id) {
    json_error('Missing id');
}

function get_member_row(string $id): ?array {
    $stmt = get_db()->prepare('SELECT * FROM team_members WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

$member = get_member_row($id);
if (!$member) {
    json_error('Team member not found', 404);
}

// -----------------------------------------------------------------
// GET — public profile view, no login required
// -----------------------------------------------------------------
if ($method === 'GET') {
    $db = get_db();

    $historyStmt = $db->prepare('SELECT * FROM history_entries WHERE team_member_id = ? ORDER BY sort_order ASC, year DESC');
    $historyStmt->execute([$id]);
    $history = array_map(function ($row) {
        return [
            'id' => $row['id'],
            'year' => $row['year'],
            'title' => $row['title'],
            'description' => $row['description'],
            'sortOrder' => (int) $row['sort_order'],
        ];
    }, $historyStmt->fetchAll());

    $pubStmt = $db->prepare('
        SELECT p.* FROM publications p
        JOIN publication_authors pa ON pa.publication_id = p.id
        WHERE pa.team_member_id = ?
        ORDER BY p.year DESC, p.created_at DESC
    ');
    $pubStmt->execute([$id]);
    $publications = array_map(function ($row) {
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
    }, $pubStmt->fetchAll());

    $newsStmt = $db->prepare('
        SELECT n.* FROM news_items n
        JOIN news_authors na ON na.news_item_id = n.id
        WHERE na.team_member_id = ?
        ORDER BY n.sort_date DESC
    ');
    $newsStmt->execute([$id]);
    $news = array_map(function ($row) {
        return [
            'id' => $row['id'],
            'date' => $row['date_label'],
            'sortDate' => $row['sort_date'],
            'type' => $row['type'],
            'emoji' => $row['emoji'],
            'title' => $row['title'],
            'description' => $row['description'],
        ];
    }, $newsStmt->fetchAll());

    json_response([
        'id' => $member['id'],
        'userId' => $member['user_id'],
        'name' => $member['name'],
        'initials' => $member['initials'],
        'role' => $member['role'],
        'category' => $member['category'],
        'department' => $member['department'],
        'bio' => $member['bio'],
        'photoUrl' => $member['photo_url'],
        'history' => $history,
        'publications' => $publications,
        'news' => $news,
    ]);
}

// -----------------------------------------------------------------
// History entries
// -----------------------------------------------------------------
if ($action === 'add_history' && $method === 'POST') {
    require_owner_or_admin($id);
    $body = read_json_body();

    if (empty($body['year']) || empty($body['title'])) {
        json_error('Year and title are required.');
    }

    $entryId = uuid();
    get_db()->prepare('
        INSERT INTO history_entries (id, team_member_id, year, title, description, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    ')->execute([
        $entryId,
        $id,
        $body['year'],
        $body['title'],
        $body['description'] ?? '',
        $body['sortOrder'] ?? 0,
    ]);

    json_response(['id' => $entryId], 201);
}

if ($action === 'update_history' && $method === 'PUT') {
    require_owner_or_admin($id);
    $entryId = $_GET['entryId'] ?? null;
    if (!$entryId) json_error('Missing entryId');

    $checkStmt = get_db()->prepare('SELECT * FROM history_entries WHERE id = ? AND team_member_id = ?');
    $checkStmt->execute([$entryId, $id]);
    $existing = $checkStmt->fetch();
    if (!$existing) json_error('History entry not found', 404);

    $body = read_json_body();
    get_db()->prepare('
        UPDATE history_entries SET year = ?, title = ?, description = ?, sort_order = ?
        WHERE id = ?
    ')->execute([
        $body['year'] ?? $existing['year'],
        $body['title'] ?? $existing['title'],
        $body['description'] ?? $existing['description'],
        $body['sortOrder'] ?? $existing['sort_order'],
        $entryId,
    ]);

    json_response(['success' => true]);
}

if ($action === 'delete_history' && $method === 'DELETE') {
    require_owner_or_admin($id);
    $entryId = $_GET['entryId'] ?? null;
    if (!$entryId) json_error('Missing entryId');

    $checkStmt = get_db()->prepare('SELECT id FROM history_entries WHERE id = ? AND team_member_id = ?');
    $checkStmt->execute([$entryId, $id]);
    if (!$checkStmt->fetch()) json_error('History entry not found', 404);

    get_db()->prepare('DELETE FROM history_entries WHERE id = ?')->execute([$entryId]);
    json_response(['success' => true]);
}

// -----------------------------------------------------------------
// Linking publications / news to this member
// (replaces the full set each time, simplest for a checkbox-list UI)
// -----------------------------------------------------------------
if ($action === 'set_publications' && $method === 'PUT') {
    require_owner_or_admin($id);
    $body = read_json_body();
    $ids = is_array($body['publicationIds'] ?? null) ? $body['publicationIds'] : [];

    $db = get_db();
    $db->beginTransaction();
    $db->prepare('DELETE FROM publication_authors WHERE team_member_id = ?')->execute([$id]);
    $insertStmt = $db->prepare('INSERT OR IGNORE INTO publication_authors (publication_id, team_member_id) VALUES (?, ?)');
    foreach ($ids as $pubId) {
        $insertStmt->execute([$pubId, $id]);
    }
    $db->commit();

    json_response(['success' => true]);
}

if ($action === 'set_news' && $method === 'PUT') {
    require_owner_or_admin($id);
    $body = read_json_body();
    $ids = is_array($body['newsIds'] ?? null) ? $body['newsIds'] : [];

    $db = get_db();
    $db->beginTransaction();
    $db->prepare('DELETE FROM news_authors WHERE team_member_id = ?')->execute([$id]);
    $insertStmt = $db->prepare('INSERT OR IGNORE INTO news_authors (news_item_id, team_member_id) VALUES (?, ?)');
    foreach ($ids as $newsId) {
        $insertStmt->execute([$newsId, $id]);
    }
    $db->commit();

    json_response(['success' => true]);
}

json_error('Unknown action or method', 405);
