import datetime
import os
import re
import urllib.request
import urllib.error
import zoneinfo

_IST = zoneinfo.ZoneInfo("Asia/Kolkata")

# URL to open when the notification is tapped.
# Set APP_URL env var to your production frontend (e.g. https://planner-936q.onrender.com).
# Falls back to localhost for local testing.
APP_URL = os.environ.get("APP_URL", "http://localhost:5174")

# Icon shown in the notification — served from the frontend's public folder
ICON_URL = f"{APP_URL}/favicon.png"

EXAM_DATE = datetime.date(2026, 5, 24)


def _today_ist() -> datetime.date:
    return datetime.datetime.now(tz=_IST).date()


def _days_to_exam():
    delta = EXAM_DATE - _today_ist()
    return max(delta.days, 0)


def _fmt_date(date_str: str) -> str:
    """'2026-03-08' → '08 Mar'"""
    try:
        d = datetime.date.fromisoformat(date_str)
        return d.strftime("%-d %b")
    except ValueError:
        return date_str


def _parse_chapters(task_text: str):
    """
    Parse '34. High Court (pp.360-362), 35. Subordinate Courts (pp.363-364)'
    Returns list of (num, title, pages) tuples.
    """
    item_regex = re.compile(r'(\d+)\.\s*(.*?)\s*\((pp\.[^)]+)\)(?:,\s*)?')
    return item_regex.findall(task_text)


def _build_chapters_block(matches) -> str:
    """
    Single-line format per chapter, no blank lines between entries:
      Ch.3  Inflation and Business Cycle — pp.20–28
    """
    if not matches:
        return ""
    lines = []
    for num, title, pages in matches:
        pretty_pages = pages.replace("-", "–")
        lines.append(f"Ch.{num}  {title.strip()} — {pretty_pages}")
    return "\n".join(lines)


def get_today_backlog_notification(schedule_cache, completion_status):
    """
    Build a notification message from the top pending backlog item.
    Priority order: Economy > Polity > History (matches frontend display order).
    Returns (subject, title, message) or None if no backlog exists.
    """
    today_str = _today_ist().isoformat()

    # Collect all past incomplete slots grouped by subject
    backlog_by_subject = {"Economy": [], "Polity": [], "History": []}

    for day in schedule_cache:
        if day["date"] >= today_str:
            continue
        for slot in day["slots"]:
            subj = slot.get("subject")
            if subj not in backlog_by_subject:
                continue
            key = f"{day['date']}_{slot['name']}"
            if not completion_status.get(key, False) and slot.get("task") != "Revision":
                backlog_by_subject[subj].append({"slot": slot, "date": day["date"]})

    # Also include today's pending slots as reminders
    today_slots = []
    for day in schedule_cache:
        if day["date"] == today_str:
            for slot in day["slots"]:
                key = f"{day['date']}_{slot['name']}"
                if not completion_status.get(key, False) and slot.get("task") != "Revision":
                    today_slots.append({"slot": slot, "date": day["date"], "subject": slot.get("subject")})
            break

    # Determine what to notify about — pick the top backlog subject
    priority_order = ["Economy", "Polity", "History"]
    is_backlog = True

    chosen_subject = None
    chosen_items = []

    for subj in priority_order:
        if backlog_by_subject[subj]:
            chosen_subject = subj
            chosen_items = backlog_by_subject[subj]
            break

    # If no backlog, fall back to today's tasks
    if not chosen_subject:
        is_backlog = False
        if today_slots:
            for subj in priority_order:
                items = [t for t in today_slots if t["subject"] == subj]
                if items:
                    chosen_subject = subj
                    chosen_items = items
                    break
        if not chosen_subject:
            return None

    top_item = chosen_items[0]
    task_text = top_item["slot"]["task"]
    item_date = top_item["date"]
    slot_name = top_item["slot"].get("name", "")

    matches = _parse_chapters(task_text)
    chapters_block = _build_chapters_block(matches)

    days_left = _days_to_exam()
    formatted_date = _fmt_date(item_date)

    # ── Title ───────────────────────────────────────────────────
    # Keep it short — ntfy shows this on the lock screen (~50 chars max)
    # The subject emoji comes from Tags, so no emoji in the title itself
    if is_backlog:
        overdue = len(chosen_items)
        title = f"{chosen_subject} - Backlog ({overdue} pending)"
    else:
        title = f"{chosen_subject} - Today's Session"

    # ── Body ───────────────────────────────────────────────────
    lines = []

    if chapters_block:
        lines.append(chapters_block)
    else:
        lines.append(task_text)

    lines.append("")

    if is_backlog:
        lines.append(f"⏳ {days_left} days to exam")
    else:
        lines.append(f"⏳ {days_left} days to exam  ·  {slot_name}")

    message = "\n".join(lines)

    return chosen_subject, title, message


def send_ntfy_notification(topic: str, title: str, message: str, tags: list = None, priority: str = "default", click_url: str = None, icon_url: str = None) -> bool:
    """
    Send a notification via ntfy.sh.
    Returns True on success, False on failure.
    """
    if not topic or not topic.strip():
        return False

    url = f"https://ntfy.sh/{topic.strip()}"
    headers = {
        "Title": title,
        "Priority": priority,
        "Content-Type": "text/plain; charset=utf-8",
    }
    # Icon takes precedence — skip Tags when a custom icon is set so ntfy
    # displays the favicon instead of the generic emoji tag icon
    if icon_url:
        headers["Icon"] = icon_url
    elif tags:
        headers["Tags"] = ",".join(tags)
    if click_url:
        headers["Click"] = click_url

    data = message.encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        print(f"ntfy HTTP error: {e.code} {e.reason}")
        return False
    except urllib.error.URLError as e:
        print(f"ntfy network error: {e.reason}")
        return False


def send_daily_notification(schedule_cache, completion_status, topic: str) -> dict:
    """
    Compose and send the daily backlog notification.
    Returns a status dict.
    """
    result = get_today_backlog_notification(schedule_cache, completion_status)
    if result is None:
        return {"status": "no_backlog", "message": "Nothing pending in backlog"}

    subject, title, message = result

    subject_tags = {
        "Economy": ["chart_with_upwards_trend"],
        "Polity": ["classical_building"],
        "History": ["scroll"],
    }
    tags = subject_tags.get(subject, ["books"])

    success = send_ntfy_notification(topic, title, message, tags=tags, priority="high", click_url=APP_URL, icon_url=ICON_URL)
    if success:
        return {"status": "sent", "subject": subject, "title": title}
    else:
        return {"status": "failed", "message": "Failed to reach ntfy.sh"}
