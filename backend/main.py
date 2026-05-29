import copy
import os
import atexit

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from scheduler import generate_schedule
from storage import load_progress, save_progress, init_db, get_preference, set_preference
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
    """Called by APScheduler every day at 8:00 AM."""
    topic = get_preference("ntfy_topic")
    if not topic:
        return
    # Regenerate schedule so the job always uses fresh date-based data
    current_schedule = generate_schedule()
    current_status = load_progress()
    send_daily_notification(current_schedule, current_status, topic)


# Set up daily scheduler — fires at 08:00 every day
scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
scheduler.add_job(
    _fire_daily_notification,
    trigger=CronTrigger(hour=8, minute=0),
    id="daily_notification",
    replace_existing=True,
)
scheduler.start()
atexit.register(lambda: scheduler.shutdown(wait=False))


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

@app.post("/api/notify")
def trigger_notification():
    """
    Manually trigger a daily backlog notification using the saved ntfy_topic.
    """
    topic = get_preference("ntfy_topic")
    if not topic:
        raise HTTPException(status_code=400, detail="No ntfy topic configured. Save one via POST /api/preferences with key=ntfy_topic.")

    current_schedule = generate_schedule()
    current_status = load_progress()
    result = send_daily_notification(current_schedule, current_status, topic)
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
