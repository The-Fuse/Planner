import copy
import os
import re
import json
import atexit
import datetime
import zoneinfo

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from scheduler import generate_schedule
from storage import (
    load_progress, save_progress, init_db, get_preference, set_preference,
    load_study_time, set_study_time,
    load_task_pages, set_task_page,
    load_revisions, set_revision,
)
from notifier import send_daily_notification

app = FastAPI()

ALLOWED_PREF_KEYS = {"ntfy_topic", "theme"}

class PreferenceInput(BaseModel):
    key: str
    value: str

_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if not _ALLOWED_ORIGINS:
    _ALLOWED_ORIGINS = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
init_db()

# Load persistent status
completion_status = load_progress()
schedule_cache = generate_schedule()


def _fire_daily_notification():
    """Called by APScheduler every day at 06:00 IST — best effort only, since
    a sleeping free-tier instance may not be running. The GitHub Actions cron
    is the reliable trigger; both share the same once-per-day guard."""
    topic = get_preference("ntfy_topic")
    if not topic:
        return
    today_ist = datetime.datetime.now(tz=zoneinfo.ZoneInfo("Asia/Kolkata")).date().isoformat()
    if get_preference("last_notified") == today_ist:
        return
    # Regenerate schedule so the job always uses fresh date-based data
    current_schedule = generate_schedule()
    current_status = load_progress()
    result = send_daily_notification(current_schedule, current_status, topic)
    if result.get("status") == "sent":
        set_preference("last_notified", today_ist)


# Set up daily scheduler — fires at 06:00 every day
scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
scheduler.add_job(
    _fire_daily_notification,
    trigger=CronTrigger(hour=6, minute=0),
    id="daily_notification",
    replace_existing=True,
)
scheduler.start()
atexit.register(lambda: scheduler.shutdown(wait=False))


@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/plan")
def get_plan():
    result = copy.deepcopy(schedule_cache)
    for day in result:
        for slot in day['slots']:
            key = f"{day['date']}_{slot['name']}"
            slot['completed'] = completion_status.get(key, False)
    return result

@app.post("/api/mark")
def mark_complete(date: str, slot_name: str, completed: bool):
    key = f"{date}_{slot_name}"
    completion_status[key] = completed
    save_progress(completion_status)
    return {"status": "success"}

@app.get("/api/marks")
def get_marks(prefix: str = ""):
    """Return the subset of completion_status whose keys start with `prefix`.
    A prefix (1..64 chars) is required so this never dumps the full store."""
    if not (1 <= len(prefix) <= 64):
        raise HTTPException(status_code=400, detail="prefix must be 1..64 chars")
    return {k: v for k, v in completion_status.items() if k.startswith(prefix)}

@app.get("/api/stats")
def get_stats():
    # Build stats dynamically from whatever subjects appear in the schedule
    stats = {}

    for day in schedule_cache:
        for slot in day['slots']:
            subj = slot['subject']
            if subj in ("Revision", "Buffer"):
                continue
            if subj not in stats:
                stats[subj] = {"total": 0, "completed": 0}
            stats[subj]["total"] += 1
            key = f"{day['date']}_{slot['name']}"
            if completion_status.get(key, False):
                stats[subj]["completed"] += 1

    completed_subjects = [subj for subj, s in stats.items() if s["total"] > 0 and s["completed"] == s["total"]]
    return {
        "stats": stats,
        "completed_subjects": completed_subjects
    }

@app.get("/api/study-time")
def get_study_time():
    """All studied seconds, keyed "date_slot"."""
    return load_study_time()

@app.post("/api/study-time")
def post_study_time(key: str, seconds: int):
    """Record total studied seconds for a task (monotonic upsert)."""
    if seconds < 0 or seconds > 24 * 3600 * 90 or len(key) > 255:
        raise HTTPException(status_code=400, detail="Invalid study-time payload")
    set_study_time(key, seconds)
    return {"status": "success", "key": key, "seconds": seconds}

@app.get("/api/task-pages")
def get_task_pages():
    """All last-page-reached records, keyed "date_slot"."""
    return load_task_pages()

@app.post("/api/task-pages")
def post_task_page(key: str, page: int, exact: bool = False):
    """Record the last page reached for a task.

    Monotonic by default; `exact=true` overwrites so a deliberate edit can
    also correct the page downwards."""
    if page <= 0 or page >= 100000 or len(key) > 255:
        raise HTTPException(status_code=400, detail="Invalid task-pages payload")
    set_task_page(key, page, exact=exact)
    return {"status": "success", "key": key, "page": page}

@app.get("/api/revisions")
def get_revisions():
    """All revision done-flags, keyed by revision key."""
    return load_revisions()

@app.post("/api/revisions")
def post_revision(key: str, done: bool):
    """Record whether a due revision has been done."""
    if not key or len(key) > 255:
        raise HTTPException(status_code=400, detail="Invalid revisions payload")
    set_revision(key, done)
    return {"status": "success", "key": key, "done": done}

@app.get("/api/preferences/{key}")
def get_pref_api(key: str):
    val = get_preference(key)
    return {"key": key, "value": val}

@app.post("/api/preferences")
def set_pref_api(pref: PreferenceInput):
    if pref.key not in ALLOWED_PREF_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown preference key: {pref.key}")
    set_preference(pref.key, pref.value)
    return {"status": "success", "key": pref.key, "value": pref.value}

_PAGE_RE = re.compile(r"pp\.(\d+)-(\d+)")


def _compute_replan_preview():
    """Simulate a fresh plan starting tomorrow, resuming each subject past the
    work already completed. No side effects.

    For every subject in the CURRENT plan we take two anchors:
      - where the current plan starts it (min first page across its slots), and
      - the furthest page reached across its COMPLETED slots.
    The resume page is max(current-plan-first-page, max-completed-page + 1),
    so a subject already fast-forwarded by RESUME_PAGES never regresses, and a
    subject with no completed slots simply stays where the plan has it.
    """
    first_page = {}     # subject -> min first page across its slots
    max_completed = {}  # subject -> max end page across COMPLETED slots

    for day in schedule_cache:
        for slot in day['slots']:
            subj = slot['subject']
            if subj in ("Revision", "Buffer"):
                continue
            ranges = _PAGE_RE.findall(slot.get('task', ''))
            if not ranges:
                continue
            fp = min(int(a) for a, _ in ranges)
            if subj not in first_page or fp < first_page[subj]:
                first_page[subj] = fp
            key = f"{day['date']}_{slot['name']}"
            if completion_status.get(key, False):
                mx = max(int(b) for _, b in ranges)
                if subj not in max_completed or mx > max_completed[subj]:
                    max_completed[subj] = mx

    resume_pages = {}
    for subj, fp in first_page.items():
        candidate = fp
        if subj in max_completed:
            candidate = max(fp, max_completed[subj] + 1)
        resume_pages[subj] = candidate

    tomorrow = datetime.date.today() + datetime.timedelta(days=1)
    sim = generate_schedule(start_date=tomorrow, resume_pages=resume_pages)
    blocks = sum(len(day['slots']) for day in sim)
    return {
        "start": tomorrow.isoformat(),
        "end": sim[-1]['date'] if sim else tomorrow.isoformat(),
        "blocks": blocks,
        "resume_pages": resume_pages,
    }


@app.get("/api/replan/preview")
def replan_preview():
    """Preview a replan-from-tomorrow without touching anything."""
    return _compute_replan_preview()


@app.post("/api/replan")
def replan():
    """Apply a replan: persist the new start date + resume pages and rebuild
    the cached schedule. Completion data is never touched. Once per day."""
    global schedule_cache
    today_iso = datetime.date.today().isoformat()
    if get_preference("last_replan") == today_iso:
        raise HTTPException(status_code=409, detail="Already replanned today")

    preview = _compute_replan_preview()
    set_preference("schedule_start", preview["start"])
    set_preference("resume_pages", json.dumps(preview["resume_pages"]))
    set_preference("last_replan", today_iso)
    schedule_cache = generate_schedule()
    return {**preview, "applied": True}


@app.post("/api/notify")
def trigger_notification(force: bool = False):
    """
    Send the daily backlog notification using the saved ntfy_topic.

    Idempotent per day (IST) so the external cron and the in-process scheduler
    can both call it without double-notifying; pass force=true to override.
    """
    topic = get_preference("ntfy_topic")
    if not topic:
        raise HTTPException(status_code=400, detail="No ntfy topic configured. Save one via POST /api/preferences with key=ntfy_topic.")

    today_ist = datetime.datetime.now(tz=zoneinfo.ZoneInfo("Asia/Kolkata")).date().isoformat()
    if not force and get_preference("last_notified") == today_ist:
        return {"status": "already_sent", "date": today_ist}

    current_schedule = generate_schedule()
    current_status = load_progress()
    result = send_daily_notification(current_schedule, current_status, topic)
    if result.get("status") == "sent":
        set_preference("last_notified", today_ist)
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
