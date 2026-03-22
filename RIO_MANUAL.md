# Rio User Manual
## Contra Job Search & Auto-Apply Agent

**For:** Rio (OpenClaw AI Agent)
**App:** Contra.com Job Search & Auto-Apply Platform
**Base URL:** `http://localhost:3000/api/v1/contra`

---

## What This App Does

This app lets Rio autonomously search for freelance jobs on Contra.com, evaluate fit using GLM-5, generate tailored cover letters, and submit applications — all via REST API calls.

---

## Quick Start

### 1. Check System Status

Before doing anything, verify the app is ready:

```http
GET http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "ok",
  "contra_configured": true,
  "glm5_configured": true,
  "user_profile": {
    "name": "Your Name",
    "skillCount": 5
  }
}
```

- `contra_configured: true` — Contra.com credentials are set
- `glm5_configured: true` — GLM-5 API key is set
- If either is `false`, the `.env` file needs to be updated (see Setup section)

---

## Core Endpoints

### Search for Jobs

```http
POST http://localhost:3000/api/v1/contra/search
Content-Type: application/json

{
  "keywords": "TypeScript Node.js backend",
  "skills": ["TypeScript", "Node.js", "PostgreSQL"],
  "budgetMin": 1000,
  "budgetMax": 10000,
  "jobType": "fixed",
  "category": "software",
  "limit": 10
}
```

**Parameters:**

| Field | Type | Required | Options / Range | Default |
|-------|------|----------|-----------------|---------|
| `keywords` | string | No | Free text | — |
| `skills` | string[] | No | Array of skill names | — |
| `budgetMin` | number | No | Any positive number | — |
| `budgetMax` | number | No | Any positive number | — |
| `jobType` | string | No | `"hourly"` or `"fixed"` | — |
| `category` | string | No | `"software"`, `"ai-ml"`, `"data-science"`, `"all"` | `"all"` |
| `limit` | number | No | 1–50 | 10 |

**Response:**
```json
{
  "count": 8,
  "jobs": [
    {
      "id": "job_abc123",
      "title": "Build a REST API",
      "description": "Need a Node.js developer...",
      "budget": 3000,
      "jobType": "fixed",
      "skills": ["Node.js", "TypeScript"],
      "postedAt": "2026-03-20T10:00:00Z"
    }
  ]
}
```

---

### Get Full Job Details

```http
GET http://localhost:3000/api/v1/contra/jobs/{jobId}
```

Replace `{jobId}` with the job ID from search results.

**Response:** Full job object including description, client info, requirements, and timeline.

---

### Apply to a Job

```http
POST http://localhost:3000/api/v1/contra/apply
Content-Type: application/json

{
  "jobId": "job_abc123",
  "coverLetter": "I am excited to apply for this role because my experience with TypeScript and REST APIs aligns directly with your requirements. I have built similar systems handling 10k+ requests/day..."
}
```

**Validation rules:**
- `jobId` — must not be empty
- `coverLetter` — must be between **50 and 5000 characters**

**Response:**
```json
{
  "success": true,
  "jobId": "job_abc123",
  "applicationId": "app_xyz789",
  "message": "Application submitted successfully",
  "appliedAt": "2026-03-22T14:30:00Z"
}
```

---

### View Submitted Applications

```http
GET http://localhost:3000/api/v1/contra/applications
```

**Response:**
```json
{
  "count": 3,
  "applications": [
    {
      "jobId": "job_abc123",
      "jobTitle": "Build a REST API",
      "status": "pending",
      "appliedAt": "2026-03-22T14:30:00Z"
    }
  ]
}
```

---

### Auto-Apply (Fully Autonomous Mode)

Let Rio handle the entire workflow — search, evaluate, write cover letters, and apply — in one call:

```http
POST http://localhost:3000/api/v1/contra/auto-apply
Content-Type: application/json

{
  "keywords": "AI backend developer",
  "maxApplications": 5,
  "minFitScore": 70,
  "dryRun": false
}
```

**Parameters:**

| Field | Type | Required | Range | Default |
|-------|------|----------|-------|---------|
| `keywords` | string | No | Free text | — |
| `maxApplications` | number | No | 1–20 | 5 |
| `minFitScore` | number | No | 0–100 | 65 |
| `dryRun` | boolean | No | `true` / `false` | `false` |

**What `dryRun: true` does:** Searches and evaluates jobs (with fit scores) but does **not** submit any applications. Use this to preview what Rio would apply to.

**Response:**
```json
{
  "jobsFound": 12,
  "jobsEvaluated": 12,
  "jobsApplied": 4,
  "jobsSkipped": 8,
  "applications": [
    {
      "jobId": "job_abc123",
      "title": "Build a REST API",
      "fitScore": 85,
      "applied": true,
      "coverLetterPreview": "I am excited to apply..."
    }
  ],
  "errors": []
}
```

**Auto-Apply Workflow (internal):**
1. Search for jobs matching keywords
2. For each job: fetch full details
3. GLM-5 evaluates fit score (0–100)
4. Skip if score < `minFitScore`
5. GLM-5 generates tailored cover letter
6. Submit application on Contra.com
7. Wait 3–5 seconds between applications (polite rate limiting)

---

## GLM-5 Function Schemas

Rio can also use this app as a tool via OpenAI-compatible function calling schemas:

```http
GET http://localhost:3000/api/v1/contra/schemas
```

Returns 5 function definitions Rio can register as tools:
- `contra_search_jobs`
- `contra_get_job`
- `contra_apply_to_job`
- `contra_get_applications`
- `contra_auto_apply`

---

## Environment Setup

The app requires a `.env` file with these variables. Ask the system administrator to configure:

### Required for Contra.com
```env
CONTRA_EMAIL=your_contra_pro_account@email.com
CONTRA_PASSWORD=your_contra_password
```
> **Note:** A Contra.com **Pro account** is required to apply to jobs.

### Required for GLM-5 (Job Evaluation & Cover Letters)
```env
GLM5_API_KEY=your_glm5_api_key
GLM5_MODEL=glm-4
GLM5_API_BASE=https://open.bigmodel.cn/api/paas/v4
```

### Rio's Profile (Used in Cover Letters & Fit Scoring)
```env
USER_NAME=Rio
USER_SKILLS=TypeScript,Python,Node.js,AI,REST APIs
USER_BIO=AI-powered freelance agent specializing in backend development and AI integrations
USER_HOURLY_RATE=150
USER_PORTFOLIO_URL=https://rio.openclaw.ai
```

### Job Search Defaults
```env
JOB_SEARCH_KEYWORDS=software engineer AI backend
JOB_MIN_BUDGET=1000
JOB_MAX_APPLICATIONS_PER_RUN=5
```

---

## Error Reference

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| `400` | Invalid input (see message) | Fix request parameters |
| `503` | Missing credentials | Check `.env` for `CONTRA_EMAIL`, `CONTRA_PASSWORD`, or `GLM5_API_KEY` |
| `500` | Server error | Check server logs |

**Common validation errors:**
- `"limit must be between 1 and 50"` — Reduce the limit value
- `"coverLetter must be at least 50 characters"` — Write a longer cover letter
- `"jobId is required"` — Include a valid job ID
- `"maxApplications must be between 1 and 20"` — Adjust maxApplications
- `"minFitScore must be between 0 and 100"` — Use a value like 65–80

---

## Recommended Usage Patterns for Rio

### Pattern 1: Dry Run First
Always preview before committing:
```
1. POST /auto-apply { dryRun: true, minFitScore: 70 }  → review fit scores
2. POST /auto-apply { dryRun: false, minFitScore: 70 } → submit applications
```

### Pattern 2: Search → Review → Apply
For more control:
```
1. POST /search { keywords: "...", limit: 20 }   → get job list
2. GET  /jobs/{id}                                → inspect promising jobs
3. POST /apply { jobId, coverLetter }             → apply selectively
```

### Pattern 3: Fully Autonomous
Set and forget:
```
1. POST /auto-apply { keywords: "AI backend", maxApplications: 5, minFitScore: 75 }
2. GET  /applications                             → check results later
```

---

## Starting the Server

```bash
npm install
npm run build
npm start
```

Server runs on `http://localhost:3000` by default (configurable via `PORT` env var).

For development with auto-reload:
```bash
npm run dev
```

---

## Running Tests

```bash
npx playwright test
```

All 20 tests should pass. This validates all endpoints are working correctly.
