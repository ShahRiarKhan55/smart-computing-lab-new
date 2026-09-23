/**
 * CLI-only seed script. Run with `npm run seed -w apps/server`.
 * Safe to re-run — it skips anything that already exists, and it is
 * NOT exposed over HTTP.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = "admin@smartcomputinglab.org";
  const password = "ChangeMe123!";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Admin account already exists, skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { email, passwordHash, role: "ADMIN" },
  });

  console.log("Created admin account:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log("  Change this password after first login!");
}

async function seedTeamMembers() {
  const count = await prisma.teamMember.count();
  if (count > 0) {
    console.log("Team members already exist, skipping.");
    return;
  }

  const members: Array<{
    name: string;
    initials: string;
    role: string;
    category: "FACULTY" | "PHD" | "MSC" | "BSC" | "RESEARCH";
    department: string;
    sortOrder: number;
  }> = [
    { name: "Assistant Prof. Riaz-Ul-Haque Mian", initials: "RUHM", role: "Lab Director", category: "FACULTY", department: "AI & Hardware Systems", sortOrder: 0 },
    { name: "Wang Weiquan", initials: "WW", role: "PhD Candidate", category: "PHD", department: "FPGA and VLSI Design", sortOrder: 1 },
    { name: "Farah Binte", initials: "FB", role: "MSc Researcher", category: "MSC", department: "Computer Vision", sortOrder: 2 },
    { name: "Matin Wazir Ahmed", initials: "MWA", role: "MSc Researcher", category: "MSC", department: "Computer Vision", sortOrder: 3 },
    { name: "K.M Shahriar Alam Adib", initials: "KMSAA", role: "MSc Researcher", category: "MSC", department: "FPGA and VLSI Design", sortOrder: 4 },
    { name: "Razib Ahmed", initials: "RA", role: "Research Student", category: "RESEARCH", department: "Satellite Image Processing", sortOrder: 5 },
    { name: "Gulnaz", initials: "G", role: "Research Student", category: "RESEARCH", department: "Computer Vision", sortOrder: 6 },
  ];

  await prisma.teamMember.createMany({ data: members });
  console.log(`Seeded ${members.length} team members.`);
}

async function seedPublications() {
  const count = await prisma.publication.count();
  if (count > 0) {
    console.log("Publications already exist, skipping.");
    return;
  }

  const pubs = [
    {
      year: 2026,
      title:
        "Optimizing FPGA and Wafer Test Coverage with Spatial Sampling and Machine Learning: Analysis of Local Spatial Consistency",
      authors: "Weiquan Wang, K.M Shahriar Alam Adib, Foisal Ahmed, Riaz-ul-haque Mian",
      venue: "MDPI Signals",
      pdfUrl: "https://www.mdpi.com/3921658",
      doiUrl: "https://doi.org/10.3390/signals7030053",
    },
    {
      year: 2026,
      title: "Enhanced detection of recycled FPGAs using Gaussian process regression with LHS and active sampling",
      authors: "Yoshito Hagihara, Foisal Ahmed, Yamane Shoma, Riaz-Ul-Haque Mian",
      venue: "ACM Transactions on Design Automation of Electronic Systems",
      pdfUrl: "https://dl.acm.org/doi/pdf/10.1145/3765907",
      doiUrl: "https://doi.org/10.1145/3765907",
    },
    {
      year: 2025,
      title: "A progressive self-training semi-supervised model to enhance discontinuous change detection",
      authors: "Yamane Soma, Sakai Yuwa, Riaz-ul-haque Mian",
      venue: "Elsevier Integration",
      pdfUrl: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5291538",
      doiUrl: "https://doi.org/10.1016/j.vlsi.2025.102609",
    },
    {
      year: 2025,
      title: "Optimizing FPGA and wafer test coverage with spatial sampling and machine learning",
      authors: "Wang WeiQuan",
      venue: "IEEE 2025 5th International Conference on Electrical, Computer and Energy Technologies (ICECET)",
      pdfUrl: "https://arxiv.org/pdf/2506.03556",
      doiUrl: "https://doi.org/10.48550/arXiv.2506.03556",
    },
  ];

  await prisma.publication.createMany({ data: pubs });
  console.log(`Seeded ${pubs.length} publications.`);
}

async function seedNews() {
  const count = await prisma.newsItem.count();
  if (count > 0) {
    console.log("News items already exist, skipping.");
    return;
  }

  const news = [
    {
      dateLabel: "May 2025",
      sortDate: "2025-05-01",
      type: "Paper",
      emoji: "📡",
      title: "Paper accepted at IEEE IGARSS 2025",
      description:
        "Our work on deep learning for SAR image analysis has been accepted at the International Geoscience and Remote Sensing Symposium.",
    },
    {
      dateLabel: "March 2025",
      sortDate: "2025-03-01",
      type: "Award",
      emoji: "🏆",
      title: "Best Paper Award at FPL 2025",
      description:
        "The FPGA team received the Best Paper Award at the International Conference on Field-Programmable Logic and Applications.",
    },
    {
      dateLabel: "February 2025",
      sortDate: "2025-02-01",
      type: "Position",
      emoji: "🎓",
      title: "PhD positions available",
      description:
        "We are recruiting fully-funded PhD students in AI-driven hardware design and satellite data analytics.",
    },
  ];

  await prisma.newsItem.createMany({ data: news });
  console.log(`Seeded ${news.length} news items.`);
}

async function seedResearchAreas() {
  const count = await prisma.researchArea.count();
  if (count > 0) {
    console.log("Research areas already exist, skipping.");
    return;
  }

  const areas = [
    { icon: "🤖", title: "Artificial Intelligence & Machine Learning", description: "Developing novel deep learning architectures, optimization techniques, and AI systems for real-world applications.", tag: "AI / ML", sortOrder: 0 },
    { icon: "🛰️", title: "Satellite Image Processing", description: "Remote sensing, geospatial analysis, and AI-driven interpretation of multispectral and SAR satellite imagery.", tag: "Remote Sensing", sortOrder: 1 },
    { icon: "⚡", title: "FPGA & Hardware Acceleration", description: "Custom digital logic design, FPGA prototyping, and hardware-software co-design for high-performance computing.", tag: "FPGA / HDL", sortOrder: 2 },
    { icon: "🔬", title: "Wafer & Semiconductor Systems", description: "Chip-level design exploration, wafer-scale integration studies, and semiconductor process optimization.", tag: "VLSI / EDA", sortOrder: 3 },
    { icon: "📊", title: "Data Science & Big Data", description: "Scalable data pipelines, distributed analytics, and predictive modeling for large heterogeneous datasets.", tag: "Data / Analytics", sortOrder: 4 },
  ];

  await prisma.researchArea.createMany({ data: areas });
  console.log(`Seeded ${areas.length} research areas.`);
}

async function main() {
  await seedAdmin();
  await seedTeamMembers();
  await seedPublications();
  await seedNews();
  await seedResearchAreas();
  console.log("\nSeed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
