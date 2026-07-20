
import datetime
import math
from data import subjects_data

# Configuration
# Rescheduled 2026-07-19: plan restarts the next day with each subject
# fast-forwarded past pages already completed under the old June schedule.
START_DATE = datetime.date(2026, 7, 20)

# First unread page per subject as of the reschedule (from completed slots:
# Western Philosophy read pp.1-86, Ethics read pp.7-71)
RESUME_PAGES = {
    "Western Philosophy": 87,
    "Ethics": 72,
}

# Page Limits
LIMITS = {
    "Morning_Polity": 15,
    "Morning_Default": 25,
    "Evening": 18,
    "Weekend_Polity": 18,
    "Weekend_Default": 25
}

def get_minutes_per_page(hardness):
    val = int(hardness + 0.5)
    if val < 1: val = 1
    if val > 5: val = 5
    mapping = {1: 3, 2: 4, 3: 6, 4: 8, 5: 10}
    return mapping[val]

def calculate_limit(tracker, slot_type, other_tracker=None, other_hardness_value=None, base_cap_override=None):
    if not tracker or tracker.finished:
        if base_cap_override is not None:
            return base_cap_override
        return LIMITS.get(slot_type, 25)

    # 1. Convert hardness -> minutes per page
    if tracker.finished or tracker.current_chapter_idx >= len(tracker.chapters):
        min_per_page = 3 # Default to easy if finished
    else:
        current_chapter = tracker.chapters[tracker.current_chapter_idx]
        hardness = current_chapter.get('hardness', 1.0)
        min_per_page = get_minutes_per_page(hardness)

    # 2. Slot reading time
    if slot_type == "Morning":
        slot_minutes = 120
    elif slot_type == "Evening":
        slot_minutes = 90
    elif slot_type == "WeekendBlock": # New slot type for weekend blocks
        slot_minutes = 90 # Assuming 1.5 hours per block
    else:
        slot_minutes = 120
    
    usable_minutes = slot_minutes - 10

    # 3. Max pages by time
    max_pages_by_time = math.floor(usable_minutes / min_per_page)

    # 4. Apply base caps
    if base_cap_override is not None:
        base_cap = base_cap_override
    else:
        base_cap = LIMITS[slot_type]
        
    adjusted_limit = min(base_cap, max_pages_by_time)

    # 5. Minimum allowed
    if adjusted_limit < 5:
        adjusted_limit = 5

    # 6. Fatigue rule
    if slot_type in ["Morning", "Evening"]:
        other_h = 1.0
        if other_hardness_value is not None:
            other_h = other_hardness_value
        elif other_tracker and not other_tracker.finished:
            other_h = other_tracker.chapters[other_tracker.current_chapter_idx].get('hardness', 1.0)
        
        if hardness >= 4 and other_h >= 4:
            adjusted_limit = math.floor(adjusted_limit * 0.85)

    return adjusted_limit

class SubjectTracker:
    def __init__(self, name, chapters, start_from_page=None):
        self.name = name
        self.chapters = chapters
        self.current_chapter_idx = 0
        self.current_page = chapters[0]['start'] if chapters else 0
        self.finished = False

        if start_from_page:
            # Fast forward logic
            # Find which chapter contains start_from_page
            found = False
            for idx, ch in enumerate(self.chapters):
                # Check if start_from_page is within this chapter or before it?
                # Actually, simply: if start_from_page is > ch['end'], we skip this chapter entirely.
                # If start_from_page is specifically IN this chapter, we start there.
                
                if start_from_page > ch['end']:
                    continue
                elif start_from_page >= ch['start']:
                    self.current_chapter_idx = idx
                    self.current_page = start_from_page
                    found = True
                    break
                else: 
                    # start_from_page < ch['start'] (gap?) -> Should just start at ch['start']
                    # This happens if we finished prev chapter at 100, and next starts at 105, and we ask to start at 101.
                    # We should just jump to this chapter's start.
                    self.current_chapter_idx = idx
                    self.current_page = ch['start']
                    found = True
                    break
            
            if not found:
                # Means start_from_page is > last chapter's end
                self.finished = True
                self.current_chapter_idx = len(self.chapters) # Boundary safety

    def get_next_chunk(self, max_pages):
        # Estimated reading minutes for the chunk (by chapter hardness) is
        # exposed via self.last_chunk_minutes after each call.
        self.last_chunk_minutes = 0
        if self.finished:
            return None

        chunk_pages = 0
        desc_parts = []

        while chunk_pages < max_pages and not self.finished:
            chapter = self.chapters[self.current_chapter_idx]
            end_page = chapter['end']
            remaining_in_chapter = end_page - self.current_page + 1
            min_per_page = get_minutes_per_page(chapter.get('hardness', 1.0))

            can_take = max_pages - chunk_pages

            if remaining_in_chapter <= can_take:
                # Finish this chapter
                desc_parts.append(f"{chapter['chapter']} (pp.{self.current_page}-{end_page})")
                chunk_pages += remaining_in_chapter
                self.last_chunk_minutes += remaining_in_chapter * min_per_page
                self.current_chapter_idx += 1
                if self.current_chapter_idx >= len(self.chapters):
                    self.finished = True
                    self.current_page = 0 # Done
                else:
                    self.current_page = self.chapters[self.current_chapter_idx]['start']
            else:
                # Partial chapter
                take_pages = can_take
                chunk_end = self.current_page + take_pages - 1
                desc_parts.append(f"{chapter['chapter']} (pp.{self.current_page}-{chunk_end})")
                self.current_page += take_pages
                chunk_pages += take_pages
                self.last_chunk_minutes += take_pages * min_per_page

        return ", ".join(desc_parts)

def generate_schedule():
    # Slot 1: Western Philosophy -> Indian Philosophy
    # Slot 2: Ethics -> Art & Culture
    # Each slot has a successor that takes over when the current subject finishes.

    # Define slot pipelines: each slot has an ordered list of subjects
    slot1_pipeline = [
        SubjectTracker("Western Philosophy", subjects_data["Western Philosophy"],
                       start_from_page=RESUME_PAGES.get("Western Philosophy")),
        SubjectTracker("Indian Philosophy", subjects_data["Indian Philosophy"],
                       start_from_page=RESUME_PAGES.get("Indian Philosophy")),
    ]
    slot2_pipeline = [
        SubjectTracker("Ethics", subjects_data["Ethics"],
                       start_from_page=RESUME_PAGES.get("Ethics")),
        SubjectTracker("Art & Culture", subjects_data["Art & Culture"],
                       start_from_page=RESUME_PAGES.get("Art & Culture")),
    ]

    # Active subjects — start with the first in each pipeline
    active_slot1 = slot1_pipeline.pop(0)
    active_slot2 = slot2_pipeline.pop(0)

    schedule = []
    current_date = START_DATE

    while True:
        # Promote successor if current slot subject is finished
        if (not active_slot1 or active_slot1.finished) and slot1_pipeline:
            active_slot1 = slot1_pipeline.pop(0)
        if (not active_slot2 or active_slot2.finished) and slot2_pipeline:
            active_slot2 = slot2_pipeline.pop(0)

        # Check completion: both slots done and no successors left
        s1_active = (active_slot1 and not active_slot1.finished)
        s2_active = (active_slot2 and not active_slot2.finished)
        if not s1_active and not s2_active:
            break

        day_name = current_date.strftime("%A")
        is_weekend = day_name in ["Saturday", "Sunday"]

        day_plan = {
            "date": current_date.isoformat(),
            "day": day_name,
            "slots": []
        }

        if not is_weekend:
            # ── Weekday: Morning (Slot 1), Evening (Slot 2) ──
            morning_hardness = 0.0

            # Slot 1 (Morning)
            if active_slot1 and not active_slot1.finished:
                morning_hardness = active_slot1.chapters[active_slot1.current_chapter_idx].get('hardness', 1.0)
                base_cap = LIMITS["Morning_Default"]

                other_h_val = None
                if active_slot2 and not active_slot2.finished:
                    other_h_val = active_slot2.chapters[active_slot2.current_chapter_idx].get('hardness', 1.0)

                limit = calculate_limit(active_slot1, "Morning", other_hardness_value=other_h_val, base_cap_override=base_cap)
                task = active_slot1.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Morning", "subject": active_slot1.name, "task": task, "minutes": active_slot1.last_chunk_minutes})
                else:
                    day_plan["slots"].append({"name": "Morning", "subject": "Revision", "task": "Subject Revision"})
                    morning_hardness = 0.0
            else:
                day_plan["slots"].append({"name": "Morning", "subject": "Revision", "task": "Subject Revision"})
                morning_hardness = 0.0

            # Slot 2 (Evening)
            if active_slot2 and not active_slot2.finished:
                limit = calculate_limit(active_slot2, "Evening", other_hardness_value=morning_hardness)
                task = active_slot2.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Evening", "subject": active_slot2.name, "task": task, "minutes": active_slot2.last_chunk_minutes})
                else:
                    day_plan["slots"].append({"name": "Evening", "subject": "Revision", "task": "Subject Revision"})
            else:
                day_plan["slots"].append({"name": "Evening", "subject": "Revision", "task": "Subject Revision"})

        else:
            # ── Weekend: Block 1 & 2 (Slot 1 subject), Block 3 (Slot 2 subject) ──

            # Block 1 — Slot 1 subject
            if active_slot1 and not active_slot1.finished:
                base_cap = LIMITS["Weekend_Default"]
                limit = calculate_limit(active_slot1, "WeekendBlock", base_cap_override=base_cap)
                task = active_slot1.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Block 1", "subject": active_slot1.name, "task": task, "minutes": active_slot1.last_chunk_minutes})
            else:
                day_plan["slots"].append({"name": "Block 1", "subject": "Buffer", "task": "Revision"})

            # Block 2 — Slot 1 subject (continued)
            if active_slot1 and not active_slot1.finished:
                limit = calculate_limit(active_slot1, "WeekendBlock", base_cap_override=LIMITS["Weekend_Default"])
                task = active_slot1.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Block 2", "subject": active_slot1.name, "task": task, "minutes": active_slot1.last_chunk_minutes})
            else:
                day_plan["slots"].append({"name": "Block 2", "subject": "Buffer", "task": "Revision"})

            # Block 3 — Slot 2 subject
            if active_slot2 and not active_slot2.finished:
                limit = calculate_limit(active_slot2, "WeekendBlock", base_cap_override=LIMITS["Weekend_Default"])
                task = active_slot2.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Block 3", "subject": active_slot2.name, "task": task, "minutes": active_slot2.last_chunk_minutes})
            else:
                day_plan["slots"].append({"name": "Block 3", "subject": "Buffer", "task": "Revision"})

        schedule.append(day_plan)
        current_date += datetime.timedelta(days=1)

    return schedule

if __name__ == "__main__":
    import json
    sched = generate_schedule()
    print(json.dumps(sched, indent=2))
