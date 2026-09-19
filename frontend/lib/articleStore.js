import fs from "fs/promises";
import path from "path";

const CWD = process.cwd();
const DATA_DIR = CWD.endsWith(`${path.sep}frontend`)
  ? path.resolve(CWD, "data")
  : path.resolve(CWD, "frontend", "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const STATUS_FILE = path.join(DATA_DIR, "agent-status.json");
const QUEUE_FILE = path.join(DATA_DIR, "agent-queue.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function ensureJsonFile(filePath, fallbackValue) {
  await ensureDir();
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallbackValue, null, 2), "utf8");
  }
}

async function readJson(filePath, fallbackValue) {
  await ensureJsonFile(filePath, fallbackValue);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw || JSON.stringify(fallbackValue));
    return parsed;
  } catch {
    return fallbackValue;
  }
}

async function writeJson(filePath, value) {
  await ensureDir();
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readArticles() {
  const articles = await readJson(ARTICLES_FILE, []);
  return Array.isArray(articles) ? articles : [];
}

export async function writeArticles(articles) {
  const nextArticles = Array.isArray(articles) ? articles : [];
  await writeJson(ARTICLES_FILE, nextArticles);
  return nextArticles;
}

export async function appendArticles(newArticles) {
  const existing = await readArticles();
  const additions = Array.isArray(newArticles) ? newArticles : [];
  const next = [...existing, ...additions];
  await writeArticles(next);
  return next;
}

export async function readStatus() {
  const status = await readJson(STATUS_FILE, {
    lastRun: null,
    articlesGenerated: 0,
    topicsAnalyzed: 0,
    status: "idle",
    currentStep: null,
    lastError: null,
  });

  return {
    lastRun: status?.lastRun || null,
    articlesGenerated: Number(status?.articlesGenerated || 0),
    topicsAnalyzed: Number(status?.topicsAnalyzed || 0),
    status: ["idle", "running", "error"].includes(status?.status) ? status.status : "idle",
    currentStep: status?.currentStep ? String(status.currentStep) : null,
    lastError: status?.lastError || null,
  };
}

export async function writeStatus(status) {
  const nextStatus = {
    lastRun: status?.lastRun || null,
    articlesGenerated: Number(status?.articlesGenerated || 0),
    topicsAnalyzed: Number(status?.topicsAnalyzed || 0),
    status: ["idle", "running", "error"].includes(status?.status) ? status.status : "idle",
    currentStep: status?.currentStep ? String(status.currentStep) : null,
    lastError: status?.lastError ?? null,
  };
  await writeJson(STATUS_FILE, nextStatus);
  return nextStatus;
}

export async function readQueue() {
  const queue = await readJson(QUEUE_FILE, []);
  return Array.isArray(queue) ? queue : [];
}

export async function writeQueue(queue) {
  const nextQueue = Array.isArray(queue) ? queue : [];
  await writeJson(QUEUE_FILE, nextQueue);
  return nextQueue;
}

export async function ensureStoreFiles() {
  await ensureJsonFile(ARTICLES_FILE, []);
  await ensureJsonFile(STATUS_FILE, {
    lastRun: null,
    articlesGenerated: 0,
    topicsAnalyzed: 0,
    status: "idle",
    currentStep: null,
    lastError: null,
  });
  await ensureJsonFile(QUEUE_FILE, []);
}

export { ARTICLES_FILE, STATUS_FILE, QUEUE_FILE };
