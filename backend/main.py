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
    load_reviews, set_review,
    load_confidence, set_confidence,
)
from notifier import send_daily_notification

app = FastAPI()

ALLOWED_PREF_KEYS = {"ntfy_topic", "theme"}

class PreferenceInput(BaseModel):
    key: str
    value: str

class ReviewInput(BaseModel):
    key: str
    state: dict

CONFIDENCE_LEVELS = {"weak", "medium", "strong"}

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

@app.get("/api/reviews")
def get_reviews():
    """All SM-2 review states, keyed by chapter slug."""
    return load_reviews()

@app.post("/api/reviews")
def post_review(review: ReviewInput):
    """Persist a chapter's full review state after a recall rating."""
    if not review.key or len(review.key) > 255:
        raise HTTPException(status_code=400, detail="Invalid review key")
    set_review(review.key, review.state)
    return {"status": "success", "key": review.key}

@app.get("/api/confidence")
def get_confidence():
    """All confidence levels, keyed by chapter slug."""
    return load_confidence()

@app.post("/api/confidence")
def post_confidence(key: str, level: str):
    """Set a chapter's confidence level (weak|medium|strong)."""
    if not key or len(key) > 255:
        raise HTTPException(status_code=400, detail="Invalid confidence key")
    if level not in CONFIDENCE_LEVELS:
        raise HTTPException(status_code=400, detail=f"level must be one of {sorted(CONFIDENCE_LEVELS)}")
    set_confidence(key, level)
    return {"status": "success", "key": key, "level": level}

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
    """Simulate a fresh plan starting TODAY, folding every unread page (all
    catch-up backlog first, then upcoming) back into the schedule. No side effects.

    For every subject in the CURRENT plan we look at each slot's page range and
    whether that slot is completed. The resume page is the EARLIEST unread page —
    the min start page across the subject's INCOMPLETE slots — so no backlog is
    ever skipped, even if a later slot was completed out of order. A subject with
    no incomplete slots is finished, so it resumes past its furthest read page
    (and the scheduler treats it as done). A subject with nothing completed simply
    stays at its current plan start.
    """
    first_page = {}       # subject -> min first page across its slots
    earliest_unread = {}  # subject -> min start page across INCOMPLETE slots
    max_completed = {}    # subject -> max end page across COMPLETED slots

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
            else:
                if subj not in earliest_unread or fp < earliest_unread[subj]:
                    earliest_unread[subj] = fp

    resume_pages = {}
    for subj, fp in first_page.items():
        if subj in earliest_unread:
            # Resume from the earliest page not yet read, so all catch-up is kept
            resume_pages[subj] = earliest_unread[subj]
        elif subj in max_completed:
            # Every slot in the window is done — pick up past the furthest page
            resume_pages[subj] = max_completed[subj] + 1
        else:
            resume_pages[subj] = fp

    today = datetime.date.today()
    sim = generate_schedule(start_date=today, resume_pages=resume_pages)
    blocks = sum(len(day['slots']) for day in sim)
    return {
        "start": today.isoformat(),
        "end": sim[-1]['date'] if sim else today.isoformat(),
        "blocks": blocks,
        "resume_pages": resume_pages,
    }


@app.get("/api/replan/preview")
def replan_preview():
    """Preview a replan-from-today without touching anything."""
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
