import fs from "node:fs";
import path from "node:path";

const [inputPath, badgePath, metricsPath] = process.argv.slice(2);

if (!inputPath || !badgePath || !metricsPath) {
  console.error(
    "Usage: node scripts/fallow-badge.mjs <report.json> <badge.json> <metrics.json>"
  );
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const report = JSON.parse(raw);
const summary = report.check?.summary ?? report.summary;

if (!summary) {
  console.error("Fallow summary not found in report JSON");
  process.exit(1);
}

const weights = {
  unused_files: 3,
  unresolved_imports: 5,
  circular_dependencies: 6,
  boundary_violations: 5,
  unused_dependencies: 3,
  unlisted_dependencies: 3,
  duplicate_exports: 2,
  unused_exports: 1,
  unused_types: 0.5,
  unused_enum_members: 0.5,
  unused_class_members: 0.5,
  type_only_dependencies: 0.5,
  test_only_dependencies: 0.5,
};

const weightedIssues = Object.entries(weights).reduce((total, [key, weight]) => {
  return total + (Number(summary[key] ?? 0) * weight);
}, 0);

// The baseline keeps the score stable and prevents it from collapsing to zero
// as soon as a repo becomes non-trivial. Lower weighted issue totals push the
// score upward; higher totals compress it toward zero.
const baseline = 100;
const score = Math.max(
  0,
  Math.min(100, Math.round((baseline / (baseline + weightedIssues)) * 100))
);

function getColor(value) {
  if (value >= 85) return "brightgreen";
  if (value >= 70) return "green";
  if (value >= 55) return "yellowgreen";
  if (value >= 40) return "yellow";
  if (value >= 25) return "orange";
  return "red";
}

const totalIssues = Number(report.check?.total_issues ?? report.total_issues ?? 0);
const version = report.version ?? report.check?.version ?? "unknown";

const badge = {
  schemaVersion: 1,
  label: "fallow maintainability",
  message: `${score}%`,
  color: getColor(score),
};

const metrics = {
  generatedAt: new Date().toISOString(),
  fallowVersion: version,
  totalIssues,
  weightedIssues: Number(weightedIssues.toFixed(1)),
  maintainabilityScore: score,
  formula: "score = round(100 * baseline / (baseline + weightedIssues))",
  baseline,
  weights,
  summary,
};

fs.mkdirSync(path.dirname(badgePath), { recursive: true });
fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
fs.writeFileSync(badgePath, `${JSON.stringify(badge, null, 2)}\n`);
fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      badge,
      metrics: {
        totalIssues,
        weightedIssues: metrics.weightedIssues,
        maintainabilityScore: score,
      },
    },
    null,
    2
  )
);
