import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeWikiPath, titleFromWikiPath, type WikiPage, type WikiTreeItem } from "@/lib/wiki";
import { buildAttachmentPromptContext, type ConvertedWikiAttachment } from "@/lib/wiki-attachments";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_INSTANCE_READY_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_SSH_READY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_READY_POLL_MS = 10 * 1000;
const DEFAULT_POST_SSH_READY_DELAY_MS = 3 * 60 * 1000;

type OpenClawProvisionInput = {
  existingInstance?: string | null;
  onInstanceRestored?: (details: {
    instance: string;
    region: string;
    restoreOutput: string;
    snapshotName: string;
  }) => Promise<void> | void;
  avatarName: string;
  ownerName: string;
  telegramBotToken: string;
};

type OpenClawAvatarSetupInput = {
  avatarGender: string;
  avatarGlbPath?: string | null;
  avatarName: string;
  instance: string;
};

type OpenClawIdentityInput = {
  avatarName: string;
  instance: string;
  ownerName: string;
};

type OpenClawGenerationInput = {
  attachments?: ConvertedWikiAttachment[];
  avatarName: string;
  instance: string;
  ownerName: string;
  projectId: string;
  projectSlug: string;
  prompt: string;
  userId: string;
};

type OpenClawFallbackWikiPage = {
  content: string;
  path: string;
};

type OpenClawWikiTreeOutputItem = Partial<WikiTreeItem> & {
  path?: string;
};

type OpenClawTelegramPairInput = {
  code: string;
  instance: string;
};

type OpenClawTelegramSetupInput = {
  instance: string;
  telegramBotToken: string;
};

type OpenClawWikiInput = {
  instance: string;
  projectSlug?: string | null;
};

type OpenClawWikiPageInput = OpenClawWikiInput & {
  filePath: string;
};

type OpenClawWikiWriteInput = OpenClawWikiPageInput & {
  baseSha?: string | null;
  content: string;
};

type OpenClawDestroyInput = {
  instance: string;
  region?: string | null;
};

type OpenClawWikiDeleteInput = {
  instance: string;
  projectSlug: string;
};

type LightsailInstance = {
  name?: string;
  publicIpAddress?: string;
  state?: {
    name?: string;
  };
};

type ExecFileFailure = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stderr?: string;
  stdout?: string;
};

const SENSITIVE_ARG_NAMES = new Set([
  "--bot-token",
  "--code",
  "--open-api-key",
  "--openai-api-key"
]);

function sanitizeLogText(value: string) {
  return value
    .replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[telegram_token]")
    .replace(/(telegram-pair\s+--instance\s+\S+\s+--code\s+)[A-Za-z0-9]{6,}/g, "$1[telegram_pair_code]")
    .replace(/(Approving Telegram pairing code\s+)[A-Za-z0-9]{6,}/g, "$1[telegram_pair_code]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[openai_key]")
    .replace(/AKIA[A-Z0-9]+/g, "[aws_access_key]")
    .replace(/(AWS_SECRET_ACCESS_KEY=)[^\s]+/g, "$1[aws_secret_key]");
}

function maskSecret(value: string | null | undefined) {
  if (!value) {
    return "[missing]";
  }

  return `[set length=${value.length}]`;
}

function summarizeLongArg(name: string, value: string) {
  if (name === "--prompt" && process.env.CLAWMACDO_DEBUG_FULL_PROMPT !== "true") {
    return `[prompt length=${value.length}]`;
  }

  return sanitizeLogText(value);
}

function sanitizeArgs(args: string[]) {
  const sanitized: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=", 2);

    if (inlineValue !== undefined && SENSITIVE_ARG_NAMES.has(name)) {
      sanitized.push(`${name}=${maskSecret(inlineValue)}`);
      continue;
    }

    if (SENSITIVE_ARG_NAMES.has(arg)) {
      sanitized.push(arg);
      index += 1;
      sanitized.push(maskSecret(args[index]));
      continue;
    }

    if (arg === "--prompt") {
      sanitized.push(arg);
      index += 1;
      sanitized.push(summarizeLongArg(arg, args[index] ?? ""));
      continue;
    }

    sanitized.push(sanitizeLogText(arg));
  }

  return sanitized;
}

function summarizeEnv(extraEnv: Record<string, string>) {
  return {
    AWS_ACCESS_KEY_ID: maskSecret(extraEnv.AWS_ACCESS_KEY_ID),
    AWS_DEFAULT_REGION: extraEnv.AWS_DEFAULT_REGION ?? "[missing]",
    AWS_REGION: extraEnv.AWS_REGION ?? "[missing]",
    AWS_SECRET_ACCESS_KEY: maskSecret(extraEnv.AWS_SECRET_ACCESS_KEY),
    OPENAI_API_KEY: maskSecret(process.env.OPENAI_API_KEY)
  };
}

function consoleClawmacdo(event: string, details: Record<string, unknown>) {
  console.info(`[clawmacdo] ${event}`, JSON.stringify(details));
}

function promptSummary(value: string) {
  if (process.env.CLAWMACDO_DEBUG_FULL_PROMPT === "true") {
    return sanitizeLogText(value);
  }

  return {
    length: value.length,
    preview: sanitizeLogText(value.slice(0, 240))
  };
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`missing_${name.toLowerCase()}`);
  }

  return value;
}

function optionalEnv(name: string) {
  return process.env[name]?.trim() || null;
}

function clawmacdoTimeout() {
  const configured = Number(process.env.CLAWMACDO_TIMEOUT_MS ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function optionalPositiveNumber(name: string, fallback: number) {
  const configured = Number(process.env[name] ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function getAwsEnv() {
  const region = requireEnv("AWS_REGION");

  return {
    AWS_ACCESS_KEY_ID: requireEnv("AWS_ACCESS_KEY_ID"),
    AWS_DEFAULT_REGION: region,
    AWS_REGION: region,
    AWS_SECRET_ACCESS_KEY: requireEnv("AWS_SECRET_ACCESS_KEY")
  };
}

function getClawmacdoBinaryPath() {
  const configured = process.env.CLAWMACDO_BIN_PATH?.trim();

  if (configured) {
    return configured;
  }

  const platformPackages: Record<string, string> = {
    "darwin-arm64": "@clawmacdo/darwin-arm64",
    "linux-x64": "@clawmacdo/linux-x64",
    "win32-x64": "@clawmacdo/win32-x64"
  };
  const platformPackage = platformPackages[`${process.platform}-${process.arch}`];

  if (!platformPackage) {
    throw new Error("unsupported_clawmacdo_platform");
  }

  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "node_modules",
    platformPackage,
    "bin",
    process.platform === "win32" ? "clawmacdo.exe" : "clawmacdo"
  );
}

function extractInstanceId(output: string) {
  const restoreJson = output.match(/RESTORE_COMPLETE_JSON:(\{.*\})/);

  if (restoreJson) {
    try {
      const parsed = JSON.parse(restoreJson[1]) as Record<string, unknown>;
      const values = [
        parsed.instance,
        parsed.instance_name,
        parsed.instanceName,
        parsed.deploy_id,
        parsed.deployId,
        parsed.name,
        parsed.ip,
        parsed.public_ip,
        parsed.publicIp
      ];
      const match = values.find((value) => typeof value === "string" && value.trim());

      if (typeof match === "string") {
        return match.trim();
      }
    } catch {
      // Fall through to text parsing.
    }
  }

  const patterns = [
    /(?:instance|deploy(?:ment)?|name|host|ip)[\s:_-]+([a-zA-Z0-9.-]+)/i,
    /\b(openclaw-[a-zA-Z0-9-]+)\b/,
    /\b(\d{1,3}(?:\.\d{1,3}){3})\b/
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function runClawmacdo(args: string[], extraEnv: Record<string, string>) {
  const binary = getClawmacdoBinaryPath();
  const timeoutMs = clawmacdoTimeout();
  const startedAt = Date.now();
  const sanitizedArgs = sanitizeArgs(args);

  consoleClawmacdo("start", {
    args: sanitizedArgs,
    binary,
    cwd: process.cwd(),
    env: summarizeEnv(extraEnv),
    timeoutMs
  });

  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      env: {
        ...process.env,
        ...extraEnv
      },
      maxBuffer: 1024 * 1024 * 4,
      timeout: timeoutMs
    });

    const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();

    consoleClawmacdo("success", {
      args: sanitizedArgs,
      durationMs: Date.now() - startedAt,
      outputLength: output.length,
      outputTail: sanitizeLogText(output.slice(-2000))
    });

    return output;
  } catch (error) {
    const failure = error as ExecFileFailure;
    const message = sanitizeLogText(failure.message || "clawmacdo_failed");

    consoleClawmacdo("failed", {
      args: sanitizedArgs,
      code: failure.code ? String(failure.code) : undefined,
      durationMs: Date.now() - startedAt,
      killed: failure.killed,
      message,
      signal: failure.signal,
      stderrTail: sanitizeLogText((failure.stderr ?? "").slice(-2000)),
      stdoutTail: sanitizeLogText((failure.stdout ?? "").slice(-2000))
    });

    throw new Error(message);
  }
}

async function runAwsJson(args: string[], extraEnv: Record<string, string>) {
  const { stdout } = await execFileAsync("aws", args, {
    env: {
      ...process.env,
      ...extraEnv
    },
    maxBuffer: 1024 * 1024 * 2,
    timeout: optionalPositiveNumber("OPENCLAW_AWS_CLI_TIMEOUT_MS", 60 * 1000)
  });

  return JSON.parse(stdout) as Record<string, unknown>;
}

function parseJsonOutput<T>(output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    const objectStart = output.indexOf("{");
    const objectEnd = output.lastIndexOf("}");
    const arrayStart = output.indexOf("[");
    const arrayEnd = output.lastIndexOf("]");
    const hasObject = objectStart !== -1 && objectEnd > objectStart;
    const hasArray = arrayStart !== -1 && arrayEnd > arrayStart;

    if (hasObject && (!hasArray || objectStart < arrayStart)) {
      return JSON.parse(output.slice(objectStart, objectEnd + 1)) as T;
    }

    if (hasArray) {
      return JSON.parse(output.slice(arrayStart, arrayEnd + 1)) as T;
    }
  }

  throw new Error("openclaw_json_parse_failed");
}

function withProjectArgs(args: string[], projectSlug?: string | null) {
  if (projectSlug?.trim()) {
    args.push("--project", projectSlug.trim());
  }

  return args;
}

function openClawAgentId() {
  return optionalEnv("OPENCLAW_AGENT_ID") ?? "main";
}

async function downloadOpenClawMarkdownZip(input: OpenClawWikiInput, outputPath?: string) {
  const awsEnv = getAwsEnv();
  const tempDir = outputPath ? null : await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-md-"));
  const zipPath = outputPath ?? path.join(tempDir ?? os.tmpdir(), `openclaw-md-${randomUUID()}.zip`);

  await runClawmacdo(
    [
      "openclaw-md-download",
      "--instance",
      input.instance,
      "--agent",
      openClawAgentId(),
      "--output",
      zipPath
    ],
    awsEnv
  );

  return {
    tempDir,
    zipPath
  };
}

async function listZipEntries(zipPath: string) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], {
    maxBuffer: 1024 * 1024 * 2,
    timeout: optionalPositiveNumber("OPENCLAW_ZIP_TIMEOUT_MS", 60 * 1000)
  });

  return stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry && /\.(md|mdx)$/i.test(entry));
}

async function readZipEntry(zipPath: string, entryPath: string) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
    timeout: optionalPositiveNumber("OPENCLAW_ZIP_TIMEOUT_MS", 60 * 1000)
  });

  return stdout;
}

function addTreePath(root: WikiTreeItem[], filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  let current = root;

  for (const [index, part] of parts.entries()) {
    const isFile = index === parts.length - 1;
    const existing = current.find((item) => item.name === part && item.type === (isFile ? "file" : "directory"));

    if (existing) {
      current = existing.children ?? current;
      continue;
    }

    const item: WikiTreeItem = {
      children: isFile ? undefined : [],
      name: part,
      path: parts.slice(0, index + 1).join("/"),
      type: isFile ? "file" : "directory"
    };

    current.push(item);

    if (!isFile) {
      current = item.children ?? current;
    }
  }
}

function buildTreeFromPaths(paths: string[]) {
  const root: WikiTreeItem[] = [];

  for (const filePath of paths.sort((left, right) => left.localeCompare(right))) {
    addTreePath(root, filePath);
  }

  return root;
}

function normalizeWikiTreeOutput(items: Array<OpenClawWikiTreeOutputItem | string>) {
  if (
    items.every(
      (item) =>
        typeof item !== "string" &&
        typeof item.name === "string" &&
        typeof item.path === "string" &&
        (item.type === "file" || item.type === "directory")
    )
  ) {
    return items as WikiTreeItem[];
  }

  const paths = items
    .map((item) => (typeof item === "string" ? item : item.path))
    .filter((item): item is string => Boolean(item));

  return buildTreeFromPaths(paths);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIpAddress(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

async function waitForTcp(host: string, port: number, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("tcp_timeout"));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });

    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

async function getLightsailInstance(instanceName: string, region: string, awsEnv: Record<string, string>) {
  const result = await runAwsJson(
    ["lightsail", "get-instance", "--instance-name", instanceName, "--region", region, "--output", "json"],
    awsEnv
  );

  return result.instance as LightsailInstance | undefined;
}

function isLightsailInstanceMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("NotFoundException") ||
    message.includes("DoesNotExist") ||
    message.includes("The Instance does not exist")
  );
}

async function getExistingLightsailInstance(
  instanceName: string,
  region: string,
  awsEnv: Record<string, string>
) {
  try {
    return await getLightsailInstance(instanceName, region, awsEnv);
  } catch (error) {
    if (isLightsailInstanceMissing(error)) {
      consoleClawmacdo("existing_instance_missing", {
        instance: instanceName,
        region
      });
      return null;
    }

    throw error;
  }
}

async function waitForLightsailInstance(
  instance: string,
  region: string,
  awsEnv: Record<string, string>
) {
  const instanceTimeoutMs = optionalPositiveNumber(
    "OPENCLAW_INSTANCE_READY_TIMEOUT_MS",
    DEFAULT_INSTANCE_READY_TIMEOUT_MS
  );
  const sshTimeoutMs = optionalPositiveNumber("OPENCLAW_SSH_READY_TIMEOUT_MS", DEFAULT_SSH_READY_TIMEOUT_MS);
  const pollMs = optionalPositiveNumber("OPENCLAW_READY_POLL_MS", DEFAULT_READY_POLL_MS);
  const start = Date.now();
  let publicIp = isIpAddress(instance) ? instance : "";
  let lastState = publicIp ? "ip-address" : "unknown";

  consoleClawmacdo("lightsail_wait_start", {
    instance,
    instanceTimeoutMs,
    pollMs,
    region,
    sshTimeoutMs
  });

  while (!publicIp || lastState !== "running") {
    if (Date.now() - start > instanceTimeoutMs) {
      throw new Error("openclaw_instance_ready_timeout");
    }

    if (isIpAddress(instance)) {
      publicIp = instance;
      lastState = "running";
      break;
    }

    const lightsailInstance = await getLightsailInstance(instance, region, awsEnv);
    publicIp = lightsailInstance?.publicIpAddress ?? "";
    lastState = lightsailInstance?.state?.name ?? "unknown";

    consoleClawmacdo("lightsail_wait_poll", {
      instance,
      publicIp: publicIp || null,
      state: lastState
    });

    if (publicIp && lastState === "running") {
      break;
    }

    await sleep(pollMs);
  }

  const sshStart = Date.now();
  let lastError = "";
  const postSshReadyDelayMs = optionalPositiveNumber(
    "OPENCLAW_POST_SSH_READY_DELAY_MS",
    DEFAULT_POST_SSH_READY_DELAY_MS
  );

  consoleClawmacdo("ssh_wait_start", {
    host: publicIp,
    instance,
    postSshReadyDelayMs,
    sshTimeoutMs
  });

  while (Date.now() - sshStart <= sshTimeoutMs) {
    try {
      await waitForTcp(publicIp, 22, Math.min(5000, pollMs));
      consoleClawmacdo("ssh_ready", {
        host: publicIp,
        instance,
        postSshReadyDelayMs
      });
      await sleep(postSshReadyDelayMs);
      consoleClawmacdo("post_ssh_delay_complete", {
        host: publicIp,
        instance
      });
      return publicIp;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "ssh_not_ready";
      consoleClawmacdo("ssh_wait_retry", {
        host: publicIp,
        instance,
        lastError
      });
      await sleep(pollMs);
    }
  }

  throw new Error(`openclaw_ssh_ready_timeout:${publicIp}:${lastError}`);
}

function absoluteFromWorkspace(relativePath: string) {
  return path.join(/* turbopackIgnore: true */ process.cwd(), relativePath);
}

function normalizeVoiceGender(value: string) {
  return value.toLowerCase() === "female" ? "female" : "male";
}

function extractFirstHttpsUrl(output: string) {
  return output.match(/https:\/\/[^\s"'<>]+/)?.[0] ?? null;
}

function getLlmWikiPromptPath() {
  const promptPath = requireEnv("OPENCLAW_LLM_WIKI_PROMPT_PATH");
  return absoluteFromWorkspace(promptPath);
}

function buildWikiGenerationPrompt(input: OpenClawGenerationInput) {
  const projectRoot = requireEnv("OPENCLAW_PROJECT_ROOT");
  const projectPath = `${projectRoot.replace(/\/$/, "")}/${input.projectSlug}`;
  const attachmentContext = buildAttachmentPromptContext(input.attachments ?? []);

  return [
    "Generate a new 2ndBrain wiki project scaffold.",
    "",
    `Owner name: ${input.ownerName}`,
    `AI avatar name: ${input.avatarName}`,
    `User id: ${input.userId}`,
    `Project id: ${input.projectId}`,
    `Project directory: ${projectPath}`,
    "",
    "User intent:",
    input.prompt,
    "",
    "Create the project directory and scaffold a practical LLM-maintained knowledge base.",
    "The scaffold must include at least README.md, CLAUDE.md, index.md, log.md, raw/, raw/assets/, wiki/, wiki/entities/, wiki/concepts/, wiki/sources/, queries/, outputs/, and tools/.",
    "Use the user intent to specialize the directory names, starter pages, conventions, and initial index content.",
    attachmentContext ? "" : null,
    attachmentContext || null,
    "Do not ask a follow-up question. Make reasonable assumptions and write the initial files."
  ].filter((line): line is string => line !== null).join("\n");
}

function yamlString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fallbackFrontmatter(title: string, type: string, tags: string[]) {
  return [
    "---",
    `title: ${yamlString(title)}`,
    `type: ${yamlString(type)}`,
    "tags:",
    ...tags.map((tag) => `  - ${yamlString(tag)}`),
    "---",
    ""
  ].join("\n");
}

function quoteMarkdown(value: string) {
  return value
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function treeHasMarkdownFiles(items: WikiTreeItem[]): boolean {
  for (const item of items) {
    if (item.type === "file") {
      return true;
    }

    if (item.children && treeHasMarkdownFiles(item.children)) {
      return true;
    }
  }

  return false;
}

function buildFallbackWikiPages(input: OpenClawGenerationInput): OpenClawFallbackWikiPage[] {
  const createdAt = new Date().toISOString();
  const projectTitle = `${input.projectSlug} 2ndBrain Wiki`;
  const promptBlock = quoteMarkdown(input.prompt || "No user intent was provided.");

  return [
    {
      path: "README.md",
      content: [
        fallbackFrontmatter(projectTitle, "overview", ["llm-wiki", "workspace"]),
        `# ${projectTitle}`,
        "",
        "This wiki was scaffolded by 2ndBrain after Claude refinement was unavailable.",
        "Use it as the working markdown base for the user's LLM-maintained knowledge system.",
        "",
        "## User Intent",
        "",
        promptBlock,
        "",
        "## Start Here",
        "",
        "- [[Index]] catalogs the wiki structure.",
        "- [[Client Profiles]] tracks people, needs, and relationship context.",
        "- [[Property Preferences]] captures requirements and constraints.",
        "- [[Follow Up Workflow]] defines the operating rhythm.",
        "- [[Source Inbox]] stores raw notes before they are synthesized.",
        "",
        "## Operating Rule",
        "",
        "Raw inputs go into `raw/`. Synthesized knowledge goes into `wiki/`. Queries and reusable outputs go into `queries/` and `outputs/`."
      ].join("\n")
    },
    {
      path: "CLAUDE.md",
      content: [
        fallbackFrontmatter("LLM Maintainer Instructions", "schema", ["llm-wiki", "agent-instructions"]),
        "# LLM Maintainer Instructions",
        "",
        "You maintain this wiki as a persistent markdown knowledge base.",
        "",
        "## Responsibilities",
        "",
        "- Read raw source notes before changing synthesized pages.",
        "- Keep [[Index]] current whenever pages are added or renamed.",
        "- Add bidirectional wiki links when concepts, entities, or workflows are related.",
        "- Preserve source facts and separate assumptions from confirmed information.",
        "- Append a short entry to [[Log]] after every meaningful update.",
        "",
        "## Directory Contract",
        "",
        "- `raw/`: source notes and imported material.",
        "- `raw/assets/`: downloaded files and attachments.",
        "- `wiki/entities/`: people, clients, organizations, properties, and vendors.",
        "- `wiki/concepts/`: reusable ideas, criteria, workflows, and decisions.",
        "- `wiki/sources/`: source summaries.",
        "- `queries/`: repeatable prompts and investigation templates.",
        "- `outputs/`: generated reports, briefs, and summaries.",
        "- `tools/`: helper scripts or documented manual tools."
      ].join("\n")
    },
    {
      path: "index.md",
      content: [
        fallbackFrontmatter("Index", "index", ["llm-wiki"]),
        "# Index",
        "",
        "## Core Pages",
        "",
        "- [[README]] - wiki overview and user intent.",
        "- [[LLM Maintainer Instructions]] - operating schema for the LLM.",
        "- [[Log]] - chronological update history.",
        "",
        "## Entity Pages",
        "",
        "- [[Client Profiles]] - client facts, preferences, and follow-up status.",
        "- [[Property Records]] - properties, listings, and relevant details.",
        "",
        "## Concept Pages",
        "",
        "- [[Property Preferences]] - budget, location, timing, and hard requirements.",
        "- [[Follow Up Workflow]] - lead follow-up and relationship cadence.",
        "- [[Matching Criteria]] - how clients are matched to properties.",
        "",
        "## Source Pages",
        "",
        "- [[Source Inbox]] - incoming raw materials before synthesis."
      ].join("\n")
    },
    {
      path: "log.md",
      content: [
        fallbackFrontmatter("Log", "log", ["llm-wiki", "history"]),
        "# Log",
        "",
        `## [${createdAt}] scaffold | Initial wiki created`,
        "",
        "Created the initial markdown scaffold from the user's stated intent. Next update should ingest real client/property source notes into `raw/` and synthesize them into entity and concept pages."
      ].join("\n")
    },
    {
      path: "raw/README.md",
      content: [
        fallbackFrontmatter("Source Inbox", "source-index", ["raw", "sources"]),
        "# Source Inbox",
        "",
        "Store raw client notes, property notes, call summaries, screenshots, and imported documents here.",
        "",
        "After adding a source, update [[Client Profiles]], [[Property Records]], [[Property Preferences]], and [[Follow Up Workflow]] as needed."
      ].join("\n")
    },
    {
      path: "raw/assets/README.md",
      content: [
        fallbackFrontmatter("Asset Inbox", "source-index", ["raw", "assets"]),
        "# Asset Inbox",
        "",
        "Store downloaded images, PDFs, listing screenshots, floor plans, and other attachments here.",
        "",
        "Reference assets from source summaries in [[Source Inbox]]."
      ].join("\n")
    },
    {
      path: "wiki/README.md",
      content: [
        fallbackFrontmatter("Wiki Home", "overview", ["wiki"]),
        "# Wiki Home",
        "",
        "This directory contains synthesized knowledge maintained by the LLM.",
        "",
        "Start with [[Client Profiles]], [[Property Records]], [[Property Preferences]], and [[Follow Up Workflow]]."
      ].join("\n")
    },
    {
      path: "wiki/entities/README.md",
      content: [
        fallbackFrontmatter("Entity Index", "index", ["entities"]),
        "# Entity Index",
        "",
        "- [[Client Profiles]]",
        "- [[Property Records]]",
        "",
        "Create one page per important client, property, organization, or recurring stakeholder when the wiki grows."
      ].join("\n")
    },
    {
      path: "wiki/entities/client-profiles.md",
      content: [
        fallbackFrontmatter("Client Profiles", "entity-index", ["clients", "crm"]),
        "# Client Profiles",
        "",
        "Track each client as a durable entity page or section.",
        "",
        "## Suggested Fields",
        "",
        "- Name and contact context.",
        "- Buying, selling, renting, or investing intent.",
        "- Budget and financing constraints.",
        "- Location preferences.",
        "- Property type and must-have requirements.",
        "- Timeline and urgency.",
        "- Latest follow-up status.",
        "",
        "Related pages: [[Property Preferences]], [[Follow Up Workflow]], [[Matching Criteria]]."
      ].join("\n")
    },
    {
      path: "wiki/entities/property-records.md",
      content: [
        fallbackFrontmatter("Property Records", "entity-index", ["properties"]),
        "# Property Records",
        "",
        "Track listings, units, developments, or areas that matter to clients.",
        "",
        "## Suggested Fields",
        "",
        "- Address or project name.",
        "- Price or rent range.",
        "- Property type, size, tenure, and availability.",
        "- Notable advantages, risks, and constraints.",
        "- Matching clients and rationale.",
        "",
        "Related pages: [[Client Profiles]], [[Property Preferences]], [[Matching Criteria]]."
      ].join("\n")
    },
    {
      path: "wiki/concepts/README.md",
      content: [
        fallbackFrontmatter("Concept Index", "index", ["concepts"]),
        "# Concept Index",
        "",
        "- [[Property Preferences]]",
        "- [[Follow Up Workflow]]",
        "- [[Matching Criteria]]"
      ].join("\n")
    },
    {
      path: "wiki/concepts/property-preferences.md",
      content: [
        fallbackFrontmatter("Property Preferences", "concept", ["requirements"]),
        "# Property Preferences",
        "",
        "Use this page to normalize how client requirements are recorded.",
        "",
        "## Preference Dimensions",
        "",
        "- Budget range and flexibility.",
        "- Preferred locations and exclusion zones.",
        "- Property type, size, rooms, floor, facing, and amenities.",
        "- School, commute, lifestyle, or investment criteria.",
        "- Deal breakers and negotiable items.",
        "",
        "Related pages: [[Client Profiles]], [[Property Records]], [[Matching Criteria]]."
      ].join("\n")
    },
    {
      path: "wiki/concepts/follow-up-workflow.md",
      content: [
        fallbackFrontmatter("Follow Up Workflow", "workflow", ["crm", "operations"]),
        "# Follow Up Workflow",
        "",
        "Use this workflow to keep client relationships active and auditable.",
        "",
        "## Cadence",
        "",
        "- Capture every meaningful conversation in `raw/`.",
        "- Update [[Client Profiles]] with the latest status.",
        "- Link relevant [[Property Records]] and explain the match or mismatch.",
        "- Record next action, owner, and target date.",
        "",
        "Related pages: [[Property Preferences]], [[Matching Criteria]], [[Log]]."
      ].join("\n")
    },
    {
      path: "wiki/concepts/matching-criteria.md",
      content: [
        fallbackFrontmatter("Matching Criteria", "concept", ["matching", "decision-support"]),
        "# Matching Criteria",
        "",
        "Define how properties are evaluated against client requirements.",
        "",
        "## Starter Scoring Areas",
        "",
        "- Requirement fit.",
        "- Budget fit.",
        "- Timeline fit.",
        "- Risk and trade-off notes.",
        "- Follow-up recommendation.",
        "",
        "Related pages: [[Client Profiles]], [[Property Records]], [[Property Preferences]]."
      ].join("\n")
    },
    {
      path: "wiki/sources/README.md",
      content: [
        fallbackFrontmatter("Source Summaries", "source-index", ["sources"]),
        "# Source Summaries",
        "",
        "Create one summary page per important raw source after ingestion.",
        "",
        "Each summary should link to affected [[Client Profiles]], [[Property Records]], and concept pages."
      ].join("\n")
    },
    {
      path: "queries/README.md",
      content: [
        fallbackFrontmatter("Queries", "query-index", ["queries"]),
        "# Queries",
        "",
        "Store repeatable questions and investigation prompts here.",
        "",
        "## Starter Queries",
        "",
        "- Which clients need follow-up this week?",
        "- Which properties match a client's stated requirements?",
        "- Which client requirements are still unknown?",
        "- Which listings have unresolved risks?"
      ].join("\n")
    },
    {
      path: "outputs/README.md",
      content: [
        fallbackFrontmatter("Outputs", "output-index", ["outputs"]),
        "# Outputs",
        "",
        "Store generated briefs, comparison tables, client summaries, and property match reports here.",
        "",
        "When an output becomes durable knowledge, link it back into [[Index]]."
      ].join("\n")
    },
    {
      path: "tools/README.md",
      content: [
        fallbackFrontmatter("Tools", "tool-index", ["tools"]),
        "# Tools",
        "",
        "Document helper scripts, import conventions, export steps, and external tools here.",
        "",
        "Keep this page updated as the wiki gains automation."
      ].join("\n")
    }
  ];
}

async function createFallbackWikiScaffold(input: OpenClawGenerationInput, reason: string) {
  const pages = buildFallbackWikiPages(input);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const page of pages) {
    const fullPath = normalizeWikiPath(`${input.projectSlug}/${page.path}`);

    try {
      const result = await writeOpenClawWikiFile({
        baseSha: "NEW",
        content: page.content,
        filePath: fullPath,
        instance: input.instance
      });

      written.push(result.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (message.includes("already_exists") || message.includes("File already exists")) {
        skipped.push(fullPath);
        continue;
      }

      throw error;
    }
  }

  return [
    "fallback_scaffold_created",
    `reason=${sanitizeLogText(reason).slice(0, 1200)}`,
    `project=${input.projectSlug}`,
    `files=${written.join(",")}`,
    `existing_files_skipped=${skipped.join(",")}`
  ].join("\n");
}

async function writeOpenClawWikiAttachments(input: OpenClawGenerationInput) {
  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
    return "";
  }

  const written: string[] = [];

  for (const attachment of attachments) {
    const fullPath = normalizeWikiPath(`${input.projectSlug}/${attachment.path}`);
    const result = await writeOpenClawWikiFile({
      baseSha: "NEW",
      content: attachment.markdown,
      filePath: fullPath,
      instance: input.instance
    });

    written.push(result.filePath);
  }

  return `attachments_written=${written.join(",")}`;
}

export async function provisionOpenClaw(input: OpenClawProvisionInput) {
  const region = requireEnv("AWS_REGION");
  const snapshotName = requireEnv("OPENCLAW_LIGHTSAIL_SNAPSHOT_NAME");
  const awsEnv = getAwsEnv();

  consoleClawmacdo("provision_input", {
    avatarName: input.avatarName,
    existingInstance: input.existingInstance ?? null,
    ownerName: input.ownerName,
    postSshReadyDelayMs: optionalPositiveNumber(
      "OPENCLAW_POST_SSH_READY_DELAY_MS",
      DEFAULT_POST_SSH_READY_DELAY_MS
    ),
    region,
    snapshotName,
    telegramBotToken: maskSecret(input.telegramBotToken)
  });

  let restoreOutput = "";
  let instance = input.existingInstance?.trim() ?? "";

  if (instance) {
    if (isIpAddress(instance)) {
      restoreOutput = `Reusing existing OpenClaw host ${instance}`;
    } else {
      const existingLightsailInstance = await getExistingLightsailInstance(instance, region, awsEnv);

      if (existingLightsailInstance) {
        restoreOutput = `Reusing existing OpenClaw instance ${instance}`;
      } else {
        restoreOutput = `Stored OpenClaw instance ${instance} was not found in Lightsail; restoring ${snapshotName}`;
        instance = "";
      }
    }
  }

  if (!instance) {
    restoreOutput = await runClawmacdo(
      ["ls-restore", "--snapshot-name", snapshotName, "--region", region],
      awsEnv
    );
    instance = extractInstanceId(restoreOutput) ?? "";
  }

  if (!instance) {
    throw new Error("openclaw_instance_not_found");
  }

  await input.onInstanceRestored?.({
    instance,
    region,
    restoreOutput,
    snapshotName
  });

  await waitForLightsailInstance(instance, region, awsEnv);

  const telegramOutput = await runClawmacdo(
    ["telegram-setup", "--instance", instance, "--bot-token", input.telegramBotToken, "--reset"],
    awsEnv
  );

  return {
    instance,
    region,
    restoreOutput,
    snapshotName,
    telegramOutput
  };
}

export async function setupOpenClawIdentity(input: OpenClawIdentityInput) {
  const awsEnv = getAwsEnv();
  const identityArgs = [
    "openclaw-identity",
    "--instance",
    input.instance,
    "--openclaw-name",
    input.avatarName,
    "--owner-name",
    input.ownerName,
    "--agent",
    openClawAgentId()
  ];

  const identityOutput = await runClawmacdo(identityArgs, awsEnv);

  return {
    identityOutput
  };
}

export async function setupOpenClawAvatar(input: OpenClawAvatarSetupInput) {
  const awsEnv = getAwsEnv();
  const openAiApiKey = requireEnv("OPENAI_API_KEY");
  const remotionAppDir = optionalEnv("OPENCLAW_REMOTION_APP_DIR");
  const remotionPort = optionalEnv("OPENCLAW_REMOTION_PORT");
  const chatModel = optionalEnv("OPENCLAW_CHAT_MODEL");
  const avatarGlbAbsolutePath = input.avatarGlbPath ? absoluteFromWorkspace(input.avatarGlbPath) : null;

  consoleClawmacdo("avatar_setup_input", {
    avatarGender: input.avatarGender,
    avatarGlbAbsolutePath,
    avatarGlbPath: input.avatarGlbPath ?? null,
    avatarName: input.avatarName,
    chatModel,
    instance: input.instance,
    openAiApiKey: maskSecret(openAiApiKey),
    remotionAppDir,
    remotionPort
  });

  const remotionArgs = [
    "remotion-avatar-setup",
    "--instance",
    input.instance,
    "--name",
    input.avatarName,
    "--openai-api-key",
    openAiApiKey,
    "--voice-gender",
    normalizeVoiceGender(input.avatarGender)
  ];

  if (remotionAppDir) {
    remotionArgs.push("--app-dir", remotionAppDir);
  }

  if (remotionPort) {
    remotionArgs.push("--port", remotionPort);
  }

  if (chatModel) {
    remotionArgs.push("--chat-model", chatModel);
  }

  if (avatarGlbAbsolutePath) {
    remotionArgs.push("--avatar-glb", avatarGlbAbsolutePath);
  }

  const remotionOutput = await runClawmacdo(remotionArgs, awsEnv);

  return {
    remotionOutput,
    remotionUrl: extractFirstHttpsUrl(remotionOutput)
  };
}

export async function generateOpenClawWikiProject(input: OpenClawGenerationInput) {
  const awsEnv = getAwsEnv();
  const prompt = buildWikiGenerationPrompt(input);
  const llmWikiPromptPath = getLlmWikiPromptPath();
  const timeout = optionalEnv("OPENCLAW_LLM_WIKI_TIMEOUT_SECONDS") ?? "600";
  const agent = optionalEnv("OPENCLAW_AGENT_ID") ?? "main";

  consoleClawmacdo("wiki_input", {
    agent,
    avatarName: input.avatarName,
    instance: input.instance,
    llmWikiPromptPath,
    ownerName: input.ownerName,
    projectId: input.projectId,
    projectSlug: input.projectSlug,
    prompt: promptSummary(prompt),
    timeout,
    userId: input.userId
  });

  const args = [
    "openclaw-llm-wiki",
    "--instance",
    input.instance,
    "--agent",
    agent,
    "--project",
    input.projectSlug,
    "--title",
    `${input.projectSlug} 2ndBrain Wiki`,
    "--prompt",
    prompt,
    "--timeout",
    timeout,
    "--llm-wiki-md",
    llmWikiPromptPath,
    "--json"
  ];

  let attachmentOutput = "";

  try {
    attachmentOutput = await writeOpenClawWikiAttachments(input);
    const output = await runClawmacdo(args, awsEnv);
    const tree = await readOpenClawWikiTree({
      instance: input.instance,
      projectSlug: input.projectSlug
    });

    if (treeHasMarkdownFiles(tree)) {
      return {
        hooksOutput: attachmentOutput,
        mapping: "openclaw-llm-wiki",
        sendOutput: output,
        task: prompt
      };
    }

    const fallbackOutput = await createFallbackWikiScaffold(
      input,
      "openclaw-llm-wiki completed but did not create project markdown files"
    );

    return {
      hooksOutput: [attachmentOutput, fallbackOutput].filter(Boolean).join("\n\n"),
      mapping: "openclaw-llm-wiki-fallback-scaffold",
      sendOutput: output,
      task: prompt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "openclaw_llm_wiki_failed";
    if (!attachmentOutput) {
      attachmentOutput = await writeOpenClawWikiAttachments(input);
    }
    const fallbackOutput = await createFallbackWikiScaffold(input, message);

    return {
      hooksOutput: [attachmentOutput, fallbackOutput].filter(Boolean).join("\n\n"),
      mapping: "openclaw-llm-wiki-fallback-scaffold",
      sendOutput: message,
      task: prompt
    };
  }
}

export async function pairOpenClawTelegram(input: OpenClawTelegramPairInput) {
  const awsEnv = getAwsEnv();

  consoleClawmacdo("telegram_pair_input", {
    code: maskSecret(input.code),
    instance: input.instance
  });

  const output = await runClawmacdo(
    ["telegram-pair", "--instance", input.instance, "--code", input.code],
    awsEnv
  );

  return {
    output
  };
}

export async function setupOpenClawTelegramBot(input: OpenClawTelegramSetupInput) {
  const awsEnv = getAwsEnv();

  consoleClawmacdo("telegram_setup_input", {
    instance: input.instance,
    telegramBotToken: maskSecret(input.telegramBotToken)
  });

  const output = await runClawmacdo(
    ["telegram-setup", "--instance", input.instance, "--bot-token", input.telegramBotToken, "--reset"],
    awsEnv
  );

  return {
    output
  };
}

export async function readOpenClawWikiTree(input: OpenClawWikiInput) {
  const awsEnv = getAwsEnv();
  let output = "";

  try {
    output = await runClawmacdo(
      withProjectArgs(
        ["wiki-tree", "--instance", input.instance, "--agent", openClawAgentId(), "--json"],
        input.projectSlug
      ),
      awsEnv
    );
    const parsed = parseJsonOutput<
      { tree?: Array<OpenClawWikiTreeOutputItem | string>; files?: Array<OpenClawWikiTreeOutputItem | string> } |
        Array<OpenClawWikiTreeOutputItem | string>
    >(output);

    if (Array.isArray(parsed)) {
      return normalizeWikiTreeOutput(parsed);
    }

    return normalizeWikiTreeOutput(parsed.tree ?? parsed.files ?? []);
  } catch {
    const downloaded = await downloadOpenClawMarkdownZip(input);

    try {
      const entries = await listZipEntries(downloaded.zipPath);

      return buildTreeFromPaths(entries);
    } finally {
      if (downloaded.tempDir) {
        await fs.rm(downloaded.tempDir, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }
}

export async function readOpenClawWikiPage(input: OpenClawWikiPageInput): Promise<WikiPage> {
  const awsEnv = getAwsEnv();
  const filePath = normalizeWikiPath(input.filePath);

  try {
    const output = await runClawmacdo(
      [
        "wiki-read",
        "--instance",
        input.instance,
        "--agent",
        openClawAgentId(),
        "--path",
        filePath,
        "--json"
      ],
      awsEnv
    );
    const parsed = parseJsonOutput<{
      content?: string;
      file_path?: string;
      path?: string;
      sha?: string | null;
      sha256?: string | null;
      title?: string;
      updated_at?: string | null;
    }>(output);
    const content = typeof parsed.content === "string" ? parsed.content : "";

    return {
      content,
      filePath: parsed.file_path ?? parsed.path ?? filePath,
      sha: parsed.sha ?? parsed.sha256 ?? null,
      title: parsed.title ?? titleFromWikiPath(filePath),
      updatedAt: parsed.updated_at ?? null
    };
  } catch {
    const downloaded = await downloadOpenClawMarkdownZip(input);

    try {
      const content = await readZipEntry(downloaded.zipPath, filePath);

      return {
        content,
        filePath,
        sha: null,
        title: titleFromWikiPath(filePath),
        updatedAt: null
      };
    } finally {
      if (downloaded.tempDir) {
        await fs.rm(downloaded.tempDir, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }
}

async function writeOpenClawWikiFile(input: OpenClawWikiWriteInput): Promise<WikiPage> {
  const awsEnv = getAwsEnv();
  const filePath = normalizeWikiPath(input.filePath);
  const tempPath = path.join(os.tmpdir(), `openclaw-wiki-${randomUUID()}.md`);
  const args = [
    "wiki-write",
    "--instance",
    input.instance,
    "--agent",
    openClawAgentId(),
    "--path",
    filePath,
    "--content-file",
    tempPath,
    "--base-sha",
    input.baseSha?.trim() || "NEW",
    "--json"
  ];

  try {
    await fs.writeFile(tempPath, input.content, "utf8");

    const output = await runClawmacdo(args, awsEnv);
    const parsed = parseJsonOutput<{
      content?: string;
      file_path?: string;
      path?: string;
      sha?: string | null;
      sha256?: string | null;
      title?: string;
      updated_at?: string | null;
    }>(output);

    return {
      content: parsed.content ?? input.content,
      filePath: parsed.file_path ?? parsed.path ?? filePath,
      sha: parsed.sha ?? parsed.sha256 ?? null,
      title: parsed.title ?? titleFromWikiPath(filePath),
      updatedAt: parsed.updated_at ?? null
    };
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

export async function writeOpenClawWikiPage(input: OpenClawWikiWriteInput): Promise<WikiPage> {
  return writeOpenClawWikiFile(input);
}

export async function exportOpenClawWiki(input: OpenClawWikiInput) {
  const awsEnv = getAwsEnv();
  let output = "";

  try {
    output = await runClawmacdo(
      withProjectArgs(
        ["wiki-export", "--instance", input.instance, "--agent", openClawAgentId(), "--json"],
        input.projectSlug
      ),
      awsEnv
    );

    return parseJsonOutput<{
      download_url?: string;
      file_path?: string;
      output?: string;
    }>(output);
  } catch {
    const outputPath = path.join(os.tmpdir(), `openclaw-md-${randomUUID()}.zip`);
    const downloaded = await downloadOpenClawMarkdownZip(input, outputPath);

    return {
      file_path: downloaded.zipPath,
      output: "openclaw-md-download"
    };
  }
}

export async function deleteOpenClawWikiProject(input: OpenClawWikiDeleteInput) {
  const awsEnv = getAwsEnv();
  const projectSlug = input.projectSlug.trim();

  if (!projectSlug) {
    throw new Error("missing_openclaw_project_slug");
  }

  const output = await runClawmacdo(
    [
      "wiki-delete",
      "--instance",
      input.instance,
      "--agent",
      openClawAgentId(),
      "--project",
      projectSlug,
      "--json"
    ],
    awsEnv
  );

  return {
    output,
    projectSlug
  };
}

export async function destroyOpenClawInstance(input: OpenClawDestroyInput) {
  const awsEnv = getAwsEnv();
  const region = input.region?.trim() || requireEnv("AWS_REGION");
  const output = await runClawmacdo(
    [
      "destroy",
      "--provider",
      "lightsail",
      "--name",
      input.instance,
      "--aws-region",
      region,
      "--yes"
    ],
    awsEnv
  );

  return {
    output,
    region
  };
}
