import { NextResponse } from "next/server";
import { readOpenClawWikiPage, readOpenClawWikiTree } from "@/lib/openclaw";
import { type WikiPage, type WikiTreeItem } from "@/lib/wiki";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

type MarkdownSearchResult = {
  filePath: string;
  lineNumber: number;
  snippet: string;
  title: string;
};

type OpenFollowUp = {
  filePath: string;
  kind: "follow_up" | "task";
  line: string;
  lineNumber: number;
  title: string;
};

const FOLLOW_UP_PATTERN =
  /\b(follow[-\s]?up|check[-\s]?in|review|grade|homework|assignment|submit|revise|study|due|todo|next step)\b/i;

function flattenMarkdownFiles(items: WikiTreeItem[]) {
  const files: WikiTreeItem[] = [];

  function walk(nodes: WikiTreeItem[]) {
    for (const node of nodes) {
      if (node.type === "file") {
        files.push(node);
      }

      if (node.children) {
        walk(node.children);
      }
    }
  }

  walk(items);

  return files;
}

function cleanLine(value: string) {
  return value
    .replace(/^\s*[-*+]\s+\[[\s]\]\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function pageTitle(page: WikiPage) {
  return page.title || page.filePath.split("/").pop()?.replace(/\.(md|mdx)$/i, "") || page.filePath;
}

function extractOpenFollowUps(page: WikiPage) {
  const title = pageTitle(page);
  const followUps: OpenFollowUp[] = [];

  page.content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    const uncheckedTask = /^\s*[-*+]\s+\[\s\]\s+/.test(line);
    const pendingKeyword = FOLLOW_UP_PATTERN.test(trimmed) && !/^\s*[-*+]\s+\[x\]\s+/i.test(line);

    if (!uncheckedTask && !pendingKeyword) {
      return;
    }

    const cleaned = cleanLine(trimmed);

    if (!cleaned) {
      return;
    }

    followUps.push({
      filePath: page.filePath,
      kind: /follow[-\s]?up|check[-\s]?in/i.test(cleaned) ? "follow_up" : "task",
      line: cleaned,
      lineNumber: index + 1,
      title
    });
  });

  return followUps;
}

function searchPage(page: WikiPage, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const title = pageTitle(page);
  const results: MarkdownSearchResult[] = [];

  page.content.split(/\r?\n/).forEach((line, index) => {
    const searchable = `${title} ${page.filePath} ${line}`.toLowerCase();

    if (!searchable.includes(normalizedQuery)) {
      return;
    }

    const snippet = cleanLine(line).slice(0, 220);

    results.push({
      filePath: page.filePath,
      lineNumber: index + 1,
      snippet: snippet || title,
      title
    });
  });

  if (
    results.length === 0 &&
    `${title} ${page.filePath}`.toLowerCase().includes(normalizedQuery)
  ) {
    results.push({
      filePath: page.filePath,
      lineNumber: 1,
      snippet: page.filePath,
      title
    });
  }

  return results;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const context = await getWikiContext(url.searchParams.get("projectId"));

    if (!context.projectSlug) {
      return NextResponse.json({ error: "LLM Wiki has not been generated yet" }, { status: 409 });
    }

    const tree = await readOpenClawWikiTree({
      instance: context.instance,
      projectSlug: context.projectSlug
    });
    const files = flattenMarkdownFiles(tree);
    const pages = await Promise.all(
      files.map((file) =>
        readOpenClawWikiPage({
          filePath: file.path,
          instance: context.instance,
          projectSlug: context.projectSlug
        })
      )
    );
    const followUps = pages.flatMap(extractOpenFollowUps).slice(0, 60);
    const searchResults = query ? pages.flatMap((page) => searchPage(page, query)).slice(0, 40) : [];

    return NextResponse.json({
      followUps,
      pageCount: pages.length,
      project: context.project,
      query,
      searchResults
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
