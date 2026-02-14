import { spawn } from "child_process";
import { access, mkdir, readFile } from "fs/promises";
import path from "path";

export interface LegalMonitoringFinding {
  severity: "high" | "medium" | "low";
  code: string;
  law_id: string;
  law_name: string;
  message: string;
  location: string;
}

export interface LegalMonitoringReport {
  generated_at: string;
  counts: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  findings: LegalMonitoringFinding[];
}

const projectRoot = process.cwd();
const reportsDir = path.join(projectRoot, "reports", "legal-monitoring");
const reportPath = path.join(reportsDir, "legal-compliance-report.json");
const monitorScriptPath = path.join(projectRoot, "scripts", "legal_compliance_monitor.py");

export async function readLatestLegalMonitoringReport(): Promise<LegalMonitoringReport | null> {
  try {
    await access(reportPath);
    const raw = await readFile(reportPath, "utf-8");
    return JSON.parse(raw) as LegalMonitoringReport;
  } catch {
    return null;
  }
}

export async function runLegalMonitoringScan(): Promise<LegalMonitoringReport> {
  await mkdir(reportsDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn("python3", [monitorScriptPath], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `Legal monitor failed with exit code ${code}`));
    });
  });

  const report = await readLatestLegalMonitoringReport();
  if (!report) {
    throw new Error("Report file was not generated.");
  }

  return report;
}
