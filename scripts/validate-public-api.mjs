const base = "https://api.xn--fhq9f80kj05g.com/api/v1";
const productionOrigin = "https://storywithlove.github.io";

function darwinDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Darwin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Accept: "application/json", ...options.headers },
    });
    return { response, milliseconds: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timeout);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const today = darwinDate();
const yesterday = addDays(today, -1);
const historyQuery = new URLSearchParams({
  start: `${yesterday}T00:00:00+09:30`,
  end: `${today}T00:00:00+09:30`,
});

const checks = [
  ["sites", "/sites", (data) =>
    Array.isArray(data.sites) && data.sites.length === 5 && Number(data.total_capacity_kw) === 1825.3],
  ["power/latest", "/power/latest", (data) =>
    Array.isArray(data.sites) && typeof data.status === "string" && data.unit === "kW" && data.timezone === "Australia/Darwin"],
  ["power/history", `/power/history?${historyQuery}`, (data) =>
    Array.isArray(data.observations) && data.interval === "5 minutes" && data.unit === "kW" && data.timezone === "Australia/Darwin"],
  ["status", "/status", (data) => typeof data.status === "string" && typeof data.api_version === "string"],
];

for (const [name, path, validate] of checks) {
  const { response, milliseconds } = await request(path);
  assert(response.ok, `${name} returned HTTP ${response.status}`);
  const data = await response.json();
  assert(validate(data), `${name} response contract did not match`);
  console.log(`${name}: HTTP ${response.status}, contract OK, ${milliseconds} ms`);
}

const cors = await request("/power/latest", { headers: { Origin: productionOrigin } });
assert(
  cors.response.headers.get("access-control-allow-origin") === productionOrigin,
  "production CORS origin was not allowed",
);
console.log("CORS: production origin allowed");

for (const localOrigin of ["http://127.0.0.1:5173", "http://localhost:5173"]) {
  const localCors = await request("/power/latest", { headers: { Origin: localOrigin } });
  assert(
    localCors.response.headers.get("access-control-allow-origin") === localOrigin,
    `local CORS origin ${localOrigin} was not allowed`,
  );
}
console.log("CORS: both documented local preview origins allowed");

const preflight = await request("/power/latest", {
  method: "OPTIONS",
  headers: {
    Origin: productionOrigin,
    "Access-Control-Request-Method": "GET",
  },
});
assert(preflight.response.ok, `preflight returned HTTP ${preflight.response.status}`);
assert(
  preflight.response.headers.get("access-control-allow-methods")?.includes("GET"),
  "preflight did not allow GET",
);
console.log("Preflight: GET allowed");

const agentPreflight = await request("/agent/query", {
  method: "OPTIONS",
  headers: {
    Origin: productionOrigin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
  },
});
assert(
  agentPreflight.response.ok,
  `Agent preflight returned HTTP ${agentPreflight.response.status}`,
);
assert(
  agentPreflight.response.headers.get("access-control-allow-methods")?.includes("POST"),
  "Agent preflight did not allow POST",
);
console.log("Agent preflight: POST allowed");

const invalidAgent = await request("/agent/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "", context: {} }),
});
assert(
  invalidAgent.response.status === 422,
  `invalid Agent request was not rejected with HTTP 422 (received ${invalidAgent.response.status})`,
);
console.log("Agent validation guard: invalid request rejected with HTTP 422");

const invalid = await request("/power/history");
assert(invalid.response.status >= 400 && invalid.response.status < 500, "missing history parameters were not rejected");
console.log(`Validation guard: missing parameters rejected with HTTP ${invalid.response.status}`);

const overlong = new URLSearchParams({
  start: `${addDays(today, -40)}T00:00:00+09:30`,
  end: `${today}T00:00:00+09:30`,
});
const overlongResponse = await request(`/power/history?${overlong}`);
assert(
  overlongResponse.response.status >= 400 && overlongResponse.response.status < 500,
  "overlong history range was not rejected",
);
console.log(`Validation guard: overlong range rejected with HTTP ${overlongResponse.response.status}`);

const writeAttempt = await request("/power/latest", { method: "POST" });
assert(
  [403, 405].includes(writeAttempt.response.status),
  "write-like method was not rejected",
);
console.log(`Read-only guard: POST rejected with HTTP ${writeAttempt.response.status}`);
