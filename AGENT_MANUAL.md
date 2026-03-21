# Rio Agent Manual — Contra.com Job Search & Apply App

This manual is written for **Rio** (OpenClaw AI Agent) to understand, configure, operate, and maintain the Contra.com job search and application system.

---

## Overview

This app gives GLM-5 (and any OpenAI-compatible LLM) the ability to:

1. **Search for freelance jobs** on Contra.com (Pro account)
2. **Evaluate job fit** using AI scoring (0-100)
3. **Generate tailored cover letters** via GLM-5
4. **Apply to jobs automatically** on Contra.com

The system runs as an **HTTP API** that GLM-5 can call as function tools.

---

## Architecture

```
GLM-5 LLM
  ↓ function_call (OpenAI-compatible)
HTTP REST API (Express — port 3000)
  ↓ GET /api/v1/contra/schemas   → returns tool definitions for GLM-5
  ↓ POST /api/v1/contra/search   → search Contra.com jobs
  ↓ GET  /api/v1/contra/jobs/:id → get job details
  ↓ POST /api/v1/contra/apply    → apply to a job
  ↓ GET  /api/v1/contra/applications → list submitted applications
  ↓ POST /api/v1/contra/auto-apply   → run full autonomous loop
    ↓
Playwright (Chromium browser automation)
  ↓ navigates Contra.com as the logged-in Pro user
  ↓ searches job listings, reads descriptions, fills application forms
    ↓
GLM-5 API (Zhipu AI)
  ↓ evaluates job fit (score 0-100)
  ↓ generates cover letters
```

---

## Setup (First-Time Configuration)

### 1. Install Dependencies

```bash
cd /home/user/ai-agent
npm install
```

### 2. Install Chromium Browser

```bash
npx playwright install chromium
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

**Critical variables for Contra job search:**

| Variable | Description | Where to get it |
|---|---|---|
| `CONTRA_EMAIL` | Your Contra.com Pro email | Your Contra account |
| `CONTRA_PASSWORD` | Your Contra.com Pro password | Your Contra account |
| `GLM5_API_KEY` | Zhipu AI API key | https://open.bigmodel.cn/usercenter/apikeys |
| `USER_NAME` | Your full name | Enter manually |
| `USER_SKILLS` | Comma-separated skills | Enter manually (e.g. `TypeScript,Python,AI`) |
| `USER_BIO` | Short professional bio | Enter manually (2-3 sentences) |
| `USER_HOURLY_RATE` | Desired hourly rate in USD | Enter manually (e.g. `150`) |

**Optional but recommended:**

| Variable | Default | Description |
|---|---|---|
| `GLM5_MODEL` | `glm-4` | Zhipu AI model name |
| `JOB_SEARCH_KEYWORDS` | `software engineer AI` | Default search keywords |
| `JOB_MAX_APPLICATIONS_PER_RUN` | `5` | Safety limit per auto-apply run |
| `CONTRA_SESSION_FILE` | `./contra-session.json` | Where to cache browser login session |

### 4. Start the Server

```bash
npm run dev
# or for production:
npm start
```

Server starts on port 3000 (configurable via `PORT`).

---

## How to Use (for GLM-5)

### Step 1: Get the Function Schemas

GLM-5 needs to know what tools are available. Fetch the schemas:

```bash
curl http://localhost:3000/api/v1/contra/schemas
```

Pass the returned `tools` array to GLM-5 in your chat completions API call.

### Step 2: Connect GLM-5 (Python example)

```python
import requests
from zhipuai import ZhipuAI

# Get function schemas from the app
schemas = requests.get("http://localhost:3000/api/v1/contra/schemas").json()
tools = schemas["tools"]

client = ZhipuAI(api_key="YOUR_GLM5_API_KEY")

response = client.chat.completions.create(
    model="glm-4",
    messages=[
        {
            "role": "user",
            "content": "Search for AI/ML engineering jobs on Contra.com, evaluate which ones "
                       "are a good fit for me, and apply to the top 3."
        }
    ],
    tools=tools,
    tool_choice="auto"
)

# Handle tool calls (GLM-5 will call contra_search_jobs, contra_apply_to_job, etc.)
# Your code should then call the REST API endpoints and return results back to GLM-5
```

### Step 3: Handle Tool Calls

When GLM-5 makes a `function_call`, map it to the REST API:

| Function Name | HTTP Request |
|---|---|
| `contra_search_jobs` | `POST /api/v1/contra/search` |
| `contra_get_job` | `GET /api/v1/contra/jobs/{jobId}` |
| `contra_apply_to_job` | `POST /api/v1/contra/apply` |
| `contra_get_applications` | `GET /api/v1/contra/applications` |
| `contra_auto_apply` | `POST /api/v1/contra/auto-apply` |

---

## Running Without GLM-5 (Standalone Mode)

The app can run autonomously without an LLM in the loop:

```bash
# Run in dry-run mode (search and evaluate, but don't apply)
npm run contra:dry

# Run and actually apply to matching jobs
npm run contra

# Custom run with flags
ts-node src/contra-agent.ts --keywords "TypeScript developer" --max 3 --dry-run
```

**CLI flags:**

| Flag | Description | Example |
|---|---|---|
| `--keywords` | Search keywords | `--keywords "machine learning"` |
| `--max` | Max applications per run | `--max 5` |
| `--min-score` | Minimum fit score (0-100) to apply | `--min-score 70` |
| `--dry-run` | Search/evaluate but don't apply | `--dry-run` |

---

## REST API Reference

### `GET /api/v1/contra/health`

Check if the app is properly configured.

```json
{
  "status": "ok",
  "contra_configured": true,
  "glm5_configured": true,
  "user_profile": {
    "name": "Your Name",
    "skills": 5
  }
}
```

### `GET /api/v1/contra/schemas`

Returns OpenAI-compatible function schemas for GLM-5. Use these as the `tools` parameter in GLM-5 API calls.

### `POST /api/v1/contra/search`

Search for jobs on Contra.com.

**Request:**
```json
{
  "keywords": "TypeScript AI developer",
  "skills": ["Node.js", "React"],
  "budgetMin": 1000,
  "jobType": "fixed",
  "limit": 10
}
```

**Response:**
```json
{
  "count": 8,
  "jobs": [
    {
      "id": "abc123",
      "title": "Full-Stack TypeScript Developer",
      "description": "We need...",
      "skills": ["TypeScript", "React", "Node.js"],
      "budgetMin": 2000,
      "budgetMax": 5000,
      "budgetType": "fixed",
      "clientName": "TechStartup Inc",
      "postedAt": "2026-03-21T12:00:00Z",
      "url": "https://contra.com/opportunity/abc123",
      "isRemote": true
    }
  ]
}
```

### `GET /api/v1/contra/jobs/:id`

Get full job details by ID or URL.

### `POST /api/v1/contra/apply`

Apply to a job.

**Request:**
```json
{
  "jobId": "abc123",
  "coverLetter": "Hi! I noticed you need a TypeScript developer..."
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "abc123",
  "applicationId": "app_1234567890",
  "message": "Application submitted successfully",
  "appliedAt": "2026-03-21T15:00:00Z"
}
```

### `GET /api/v1/contra/applications`

List all submitted applications with their status.

### `POST /api/v1/contra/auto-apply`

Run the full autonomous loop.

**Request:**
```json
{
  "keywords": "AI engineer",
  "maxApplications": 5,
  "minFitScore": 65,
  "dryRun": false
}
```

**Response:**
```json
{
  "jobsFound": 15,
  "jobsEvaluated": 15,
  "jobsApplied": 4,
  "jobsSkipped": 11,
  "applications": [
    { "success": true, "jobId": "abc", "message": "Applied" },
    { "success": true, "jobId": "def", "message": "Applied" }
  ],
  "errors": []
}
```

---

## File Structure Reference

```
src/
  services/contra/
    types.ts          — TypeScript interfaces (ContraJob, SearchFilters, etc.)
    browser.ts        — Playwright browser manager (singleton)
    auth.ts           — Contra.com login/session management
    search.ts         — Job search and scraping
    apply.ts          — Job application submission
    glm5-client.ts    — GLM-5 API client (cover letters + fit scoring + function schemas)
    index.ts          — Auto-apply orchestrator loop
  routes/
    contra.ts         — Express REST API routes
  contra-agent.ts     — Standalone CLI script
```

---

## Troubleshooting

### "Contra credentials not configured"
→ Set `CONTRA_EMAIL` and `CONTRA_PASSWORD` in `.env`

### "GLM-5 API key not configured"
→ Set `GLM5_API_KEY` in `.env`

### Login fails
→ Check credentials in `.env`. Delete `contra-session.json` to force a fresh login.

### "Apply button not found"
→ Contra.com's page structure may have changed. The selectors in `src/services/contra/apply.ts` may need updating. Look at the actual page HTML and update the selectors in the `applyBtn` query.

### No jobs found
→ Try broader `keywords`. Contra.com may require login to see all jobs — check if `isLoggedIn()` returns true in the logs.

### Chromium not installed
→ Run `npx playwright install chromium`

### Browser crashes / timeout
→ Increase timeout values in `browser.ts`. For low-memory environments, ensure Docker has at least 2GB RAM.

---

## Security Notes

- Credentials are stored in `.env` — **never commit this file**
- Browser session cookies are stored in `contra-session.json` — **exclude from git**
- The `.gitignore` already excludes `.env` and `*.json` session files
- The API has no auth by default — only expose on localhost or behind a VPN/auth proxy in production

---

## Scheduled Runs (Cron)

To run the agent automatically every day at 9 AM:

```bash
# Add to crontab:  crontab -e
0 9 * * * cd /home/user/ai-agent && npm run contra >> /var/log/contra-agent.log 2>&1
```

Or with dry-run on weekdays and live on Mondays:

```bash
0 9 * * 1   cd /home/user/ai-agent && npm run contra
0 9 * * 2-5 cd /home/user/ai-agent && npm run contra:dry
```

---

*Built by Claude Code — managed by Rio (OpenClaw AI Agent)*
