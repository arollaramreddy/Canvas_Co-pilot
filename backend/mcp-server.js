const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { db } = require("./lib/db");
const { computeInterventionScore } = require("./lib/intelligence");
const { listRecentEvents, listWorkflowJobs } = require("./lib/state-sync");
const { createProductMcpServer } = require("./lib/mcp");

const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL || "https://canvas.asu.edu/api/v1";
const MCP_CANVAS_TOKEN = process.env.MCP_CANVAS_TOKEN;

async function canvasRequest(pathname, accessToken = MCP_CANVAS_TOKEN) {
  if (!accessToken) {
    throw new Error("No Canvas access token available");
  }

  const res = await fetch(`${CANVAS_BASE_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canvas API error (${res.status}): ${text}`);
  }

  return res.json();
}

async function canvasRequestAll(pathname, accessToken = MCP_CANVAS_TOKEN) {
  if (!accessToken) {
    throw new Error("No Canvas access token available");
  }

  let url = `${CANVAS_BASE_URL}${pathname}`;
  let all = [];

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Canvas API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    all = all.concat(data);

    const link = res.headers.get("link");
    const next = link?.split(",").find((entry) => entry.includes('rel="next"'));
    const match = next?.match(/<([^>]+)>/);
    url = match ? match[1] : null;
  }

  return all;
}

async function buildWorkspaceState(courseId, accessToken = MCP_CANVAS_TOKEN) {
  const [course, assignments, modules] = await Promise.all([
    canvasRequest(`/courses/${courseId}`, accessToken),
    canvasRequestAll(`/courses/${courseId}/assignments?per_page=50&order_by=due_at`, accessToken),
    canvasRequestAll(`/courses/${courseId}/modules?per_page=50&include[]=items_count`, accessToken),
  ]);

  return {
    syncedAt: new Date().toISOString(),
    course: {
      id: course.id,
      name: course.name,
      code: course.course_code,
      enrollment_term_id: course.enrollment_term_id,
    },
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      name: assignment.name,
      due_at: assignment.due_at,
      points_possible: assignment.points_possible,
    })),
    modules: modules.map((module) => ({
      id: module.id,
      name: module.name,
      items_count: module.items_count,
      state: module.state,
    })),
  };
}

async function main() {
  const server = createProductMcpServer({
    db,
    canvasRequest,
    canvasRequestAll,
    buildWorkspaceState,
    computeInterventionScore,
    listRecentEvents,
    listWorkflowJobs,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
