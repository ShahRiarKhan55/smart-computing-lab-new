<?php
/**
 * seed.php
 *
 * Run this once to populate the database with an admin account and
 * starter content. Safe to re-run — it skips anything that already exists.
 *
 * Run from the command line:   php seed.php
 * Or visit in a browser:       http://yoursite.com/seed.php
 */

require_once __DIR__ . '/api/config.php';

$db = get_db();
$output = [];

// ---------------------------------------------------------------
// 1. Admin account
// ---------------------------------------------------------------
$adminEmail = 'admin@smartcomputinglab.org';
$adminPassword = 'ChangeMe123!';

$stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
$stmt->execute([$adminEmail]);

if (!$stmt->fetch()) {
    $hash = password_hash($adminPassword, PASSWORD_DEFAULT);
    $db->prepare('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
        ->execute([uuid(), $adminEmail, $hash, 'ADMIN']);

    $output[] = "Created admin account:";
    $output[] = "  email:    $adminEmail";
    $output[] = "  password: $adminPassword";
    $output[] = "  ⚠️  Change this password after first login!";
} else {
    $output[] = "Admin account already exists, skipping.";
}

// ---------------------------------------------------------------
// 2. Team members
// ---------------------------------------------------------------
$count = (int) $db->query('SELECT COUNT(*) FROM team_members')->fetchColumn();

if ($count === 0) {
    $members = [
        ['Assistant Prof. Riaz-Ul-Haque Mian', 'RUHM', 'Lab Director', 'FACULTY', 'AI & Hardware Systems', 0],
        ['Wang Weiquan', 'WW', 'PhD Candidate', 'PHD', 'FPGA and VLSI Design', 1],
        ['Farah Binte', 'FB', 'MSc Researcher', 'MSC', 'Computer Vision', 2],
        ['Matin Wazir Ahmed', 'MWA', 'MSc Researcher', 'MSC', 'Computer Vision', 3],
        ['K.M Shahriar Alam Adib', 'KMSAA', 'MSc Researcher', 'MSC', 'FPGA and VLSI Design', 4],
        ['Razib Ahmed', 'RA', 'Research Student', 'RESEARCH', 'Satellite Image Processing', 5],
        ['Gulnaz', 'G', 'Research Student', 'RESEARCH', 'Computer Vision', 6],
    ];

    $stmt = $db->prepare('
        INSERT INTO team_members (id, user_id, name, initials, role, category, department, bio, photo_url, sort_order)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ');

    foreach ($members as [$name, $initials, $role, $category, $department, $sortOrder]) {
        $stmt->execute([uuid(), $name, $initials, $role, $category, $department, '', '', $sortOrder]);
    }

    $output[] = "Seeded " . count($members) . " team members.";
} else {
    $output[] = "Team members already exist, skipping.";
}

// ---------------------------------------------------------------
// 3. Publications
// ---------------------------------------------------------------
$count = (int) $db->query('SELECT COUNT(*) FROM publications')->fetchColumn();

if ($count === 0) {
    $pubs = [
        [
            2026,
            'Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency',
            'Weiquan Wang, K.M Shahriar Alam Adib, Foisal Ahmed, Riaz-ul-haque Mian',
            'MDPI Signals',
            'https://www.mdpi.com/3921658',
            'https://doi.org/10.3390/signals7030053',
        ],
        [
            2026,
            'Enhanced detection of recycled FPGAs using Gaussian process regression with LHS and active sampling',
            'Yoshito Hagihara, Foisal Ahmed, Yamane Shoma, Riaz-Ul-Haque Mian',
            'ACM Transactions on Design Automation of Electronic Systems',
            'https://dl.acm.org/doi/pdf/10.1145/3765907',
            'https://doi.org/10.1145/3765907',
        ],
        [
            2025,
            'A progressive self-training semi-supervised model to enhance discontinuous change detection',
            'Yamane Soma, Sakai Yuwa, Riaz-ul-haque Mian',
            'Elsevier Integration',
            'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5291538',
            'https://doi.org/10.1016/j.vlsi.2025.102609',
        ],
        [
            2025,
            'Optimizing FPGA and wafer test coverage with spatial sampling and machine learning',
            'Wang WeiQuan',
            'IEEE 2025 5th International Conference on Electrical, Computer and Energy Technologies (ICECET)',
            'https://arxiv.org/pdf/2506.03556',
            'https://doi.org/10.48550/arXiv.2506.03556',
        ],
    ];

    $stmt = $db->prepare('
        INSERT INTO publications (id, year, title, authors, venue, pdf_url, doi_url, extra_url, extra_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ');

    foreach ($pubs as [$year, $title, $authors, $venue, $pdfUrl, $doiUrl]) {
        $stmt->execute([uuid(), $year, $title, $authors, $venue, $pdfUrl, $doiUrl, '', '']);
    }

    $output[] = "Seeded " . count($pubs) . " publications.";
} else {
    $output[] = "Publications already exist, skipping.";
}

// ---------------------------------------------------------------
// 4. News
// ---------------------------------------------------------------
$count = (int) $db->query('SELECT COUNT(*) FROM news_items')->fetchColumn();

if ($count === 0) {
    $news = [
        ['May 2025', '2025-05-01', 'Paper', '📡', 'Paper accepted at IEEE IGARSS 2025', 'Our work on deep learning for SAR image analysis has been accepted at the International Geoscience and Remote Sensing Symposium.'],
        ['March 2025', '2025-03-01', 'Award', '🏆', 'Best Paper Award at FPL 2025', 'The FPGA team received the Best Paper Award at the International Conference on Field-Programmable Logic and Applications.'],
        ['February 2025', '2025-02-01', 'Position', '🎓', 'PhD positions available', 'We are recruiting fully-funded PhD students in AI-driven hardware design and satellite data analytics.'],
    ];

    $stmt = $db->prepare('
        INSERT INTO news_items (id, date_label, sort_date, type, emoji, title, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');

    foreach ($news as [$date, $sortDate, $type, $emoji, $title, $description]) {
        $stmt->execute([uuid(), $date, $sortDate, $type, $emoji, $title, $description]);
    }

    $output[] = "Seeded " . count($news) . " news items.";
} else {
    $output[] = "News items already exist, skipping.";
}

// ---------------------------------------------------------------
// 5. Research areas
// ---------------------------------------------------------------
$count = (int) $db->query('SELECT COUNT(*) FROM research_areas')->fetchColumn();

if ($count === 0) {
    $areas = [
        ['🤖', 'Artificial Intelligence & Machine Learning', 'Developing novel deep learning architectures, optimization techniques, and AI systems for real-world applications.', 'AI / ML', 0],
        ['🛰️', 'Satellite Image Processing', 'Remote sensing, geospatial analysis, and AI-driven interpretation of multispectral and SAR satellite imagery.', 'Remote Sensing', 1],
        ['⚡', 'FPGA & Hardware Acceleration', 'Custom digital logic design, FPGA prototyping, and hardware-software co-design for high-performance computing.', 'FPGA / HDL', 2],
        ['🔬', 'Wafer & Semiconductor Systems', 'Chip-level design exploration, wafer-scale integration studies, and semiconductor process optimization.', 'VLSI / EDA', 3],
        ['📊', 'Data Science & Big Data', 'Scalable data pipelines, distributed analytics, and predictive modeling for large heterogeneous datasets.', 'Data / Analytics', 4],
    ];

    $stmt = $db->prepare('
        INSERT INTO research_areas (id, icon, title, description, tag, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    ');

    foreach ($areas as [$icon, $title, $description, $tag, $sortOrder]) {
        $stmt->execute([uuid(), $icon, $title, $description, $tag, $sortOrder]);
    }

    $output[] = "Seeded " . count($areas) . " research areas.";
} else {
    $output[] = "Research areas already exist, skipping.";
}

$output[] = "";
$output[] = "Seed complete.";

// Print nicely whether run via CLI or browser
if (php_sapi_name() === 'cli') {
    echo implode("\n", $output) . "\n";
} else {
    header('Content-Type: text/plain');
    echo implode("\n", $output) . "\n";
}
