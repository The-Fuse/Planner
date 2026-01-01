
import datetime
import math
from data import subjects_data

# Configuration
START_DATE = datetime.date(2026, 1, 1)

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

    def get_next_chunk(self, max_pages):
        if self.finished:
            return None

        chunk_pages = 0
        desc_parts = []
        
        while chunk_pages < max_pages and not self.finished:
            chapter = self.chapters[self.current_chapter_idx]
            end_page = chapter['end']
            remaining_in_chapter = end_page - self.current_page + 1
            
            can_take = max_pages - chunk_pages
            
            if remaining_in_chapter <= can_take:
                # Finish this chapter
                desc_parts.append(f"{chapter['chapter']} (pp.{self.current_page}-{end_page})")
                chunk_pages += remaining_in_chapter
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
        
        return ", ".join(desc_parts)

def generate_schedule():
    # Initialize Trackers with progress overrides
    # History: completed till 371 -> start at 372
    # Polity: completed till 344 -> start at 345
    
    waiting_list = [
        SubjectTracker("Polity", subjects_data["Polity"], start_from_page=345),
        SubjectTracker("History", subjects_data["History"], start_from_page=372),
    ]
    
    # Active subjects
    active_slot1 = waiting_list.pop(0) if waiting_list else None
    active_slot2 = waiting_list.pop(0) if waiting_list else None
    
    schedule = []
    
    current_date = START_DATE
    
    # Run until both active slots are finished AND no one is waiting
    while True:
        # Check completion condition
        s1_active = (active_slot1 and not active_slot1.finished)
        s2_active = (active_slot2 and not active_slot2.finished)
        
        if not s1_active and not s2_active and not waiting_list:
            break

        day_name = current_date.strftime("%A")
        is_weekend = day_name in ["Saturday", "Sunday"]
        
        day_plan = {
            "date": current_date.isoformat(),
            "day": day_name,
            "slots": []
        }
        
        if not is_weekend:
            # Weekday: Morning (Slot 1), Evening (Slot 2)
            
            morning_hardness = 0.0

            # Slot 1
            if active_slot1 and not active_slot1.finished:
                morning_hardness = active_slot1.chapters[active_slot1.current_chapter_idx].get('hardness', 1.0)
                base_cap = LIMITS["Morning_Polity"] if active_slot1.name == "Polity" else LIMITS["Morning_Default"]
                
                # Check slot2 hardness for fatigue check? Not directly available until we check it.
                # But we can peek.
                other_h_val = None
                if active_slot2 and not active_slot2.finished:
                    other_h_val = active_slot2.chapters[active_slot2.current_chapter_idx].get('hardness', 1.0)

                limit = calculate_limit(active_slot1, "Morning", other_hardness_value=other_h_val, base_cap_override=base_cap)
                task = active_slot1.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Morning", "subject": active_slot1.name, "task": task})
            elif active_slot1 and active_slot1.finished:
                 # Replace if finished
                if waiting_list:
                    active_slot1 = waiting_list.pop(0)
                    morning_hardness = active_slot1.chapters[active_slot1.current_chapter_idx].get('hardness', 1.0)
                    base_cap = LIMITS["Morning_Polity"] if active_slot1.name == "Polity" else LIMITS["Morning_Default"]
                    
                    # Recalculate fatigue?
                    other_h_val = None
                    if active_slot2 and not active_slot2.finished:
                        other_h_val = active_slot2.chapters[active_slot2.current_chapter_idx].get('hardness', 1.0)
                        
                    limit = calculate_limit(active_slot1, "Morning", other_hardness_value=other_h_val, base_cap_override=base_cap)
                    task = active_slot1.get_next_chunk(limit)
                    if task:
                        day_plan["slots"].append({"name": "Morning", "subject": active_slot1.name, "task": task})
                # Else: leave empty or buffer? Original logic added Buffer. 
                # If we want to end when tasks end, strictly we might not need buffer if it extends the schedule artificially. 
                # But user said "end date ... when longest subject ends". So shorter subject might have buffers.
                # However, original logic just added "Buffer" tasks indefinitely until END_DATE.
                # Since we removed fixed END_DATE, we shouldn't add infinite buffers.
                # We should only add buffer if AT LEAST ONE other subject is still running.
                else: 
                     if s2_active: # If the other slot is still running, fill this with revision/buffer
                         day_plan["slots"].append({"name": "Morning", "subject": "Buffer", "task": "Revision"})
                         morning_hardness = 0.0

            # Slot 2
            if active_slot2 and not active_slot2.finished:
                limit = calculate_limit(active_slot2, "Evening", other_hardness_value=morning_hardness)
                task = active_slot2.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Evening", "subject": active_slot2.name, "task": task})
            elif active_slot2 and active_slot2.finished:
                 # Replace
                if waiting_list:
                    active_slot2 = waiting_list.pop(0)
                    limit = calculate_limit(active_slot2, "Evening", other_hardness_value=morning_hardness)
                    task = active_slot2.get_next_chunk(limit)
                    if task:
                        day_plan["slots"].append({"name": "Evening", "subject": active_slot2.name, "task": task})
                else:
                    # Only add buffer if slot 1 is still active
                    if (active_slot1 and not active_slot1.finished):
                        day_plan["slots"].append({"name": "Evening", "subject": "Buffer", "task": "Revision"})

        else:
            # Weekend: Block 1 (Subj 1), Block 2 (Subj 2), Block 3 (Balance)
            
            # Block 1
            if active_slot1 and not active_slot1.finished:
                base_cap = LIMITS["Weekend_Polity"] if active_slot1.name == "Polity" else LIMITS["Weekend_Default"]
                limit = calculate_limit(active_slot1, "WeekendBlock", base_cap_override=base_cap)
                task = active_slot1.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Block 1", "subject": active_slot1.name, "task": task})
            elif active_slot1 and active_slot1.finished:
                if waiting_list:
                    active_slot1 = waiting_list.pop(0)
                    base_cap = LIMITS["Weekend_Polity"] if active_slot1.name == "Polity" else LIMITS["Weekend_Default"]
                    limit = calculate_limit(active_slot1, "WeekendBlock", base_cap_override=base_cap)
                    task = active_slot1.get_next_chunk(limit)
                    if task:
                        day_plan["slots"].append({"name": "Block 1", "subject": active_slot1.name, "task": task})
                else:
                    if (active_slot2 and not active_slot2.finished):
                        day_plan["slots"].append({"name": "Block 1", "subject": "Buffer", "task": "Revision"})
            
            # Block 2
            if active_slot2 and not active_slot2.finished:
                limit = calculate_limit(active_slot2, "WeekendBlock", base_cap_override=LIMITS["Weekend_Default"])
                task = active_slot2.get_next_chunk(limit)
                if task:
                    day_plan["slots"].append({"name": "Block 2", "subject": active_slot2.name, "task": task})
            elif active_slot2 and active_slot2.finished:
                if waiting_list:
                    active_slot2 = waiting_list.pop(0)
                    limit = calculate_limit(active_slot2, "WeekendBlock", base_cap_override=LIMITS["Weekend_Default"])
                    task = active_slot2.get_next_chunk(limit)
                    if task:
                        day_plan["slots"].append({"name": "Block 2", "subject": active_slot2.name, "task": task})
                else:
                    if (active_slot1 and not active_slot1.finished):
                        day_plan["slots"].append({"name": "Block 2", "subject": "Buffer", "task": "Revision"})
            
            # Block 3
            target_for_block3 = active_slot2 if (active_slot2 and not active_slot2.finished) else active_slot1
            
            if target_for_block3 and not target_for_block3.finished:
                 limit = calculate_limit(target_for_block3, "WeekendBlock", base_cap_override=LIMITS["Weekend_Default"])
                 task = target_for_block3.get_next_chunk(limit)
                 if task:
                    day_plan["slots"].append({"name": "Block 3", "subject": target_for_block3.name, "task": task})
        
        schedule.append(day_plan)
        current_date += datetime.timedelta(days=1)
        
    return schedule

if __name__ == "__main__":
    import json
    sched = generate_schedule()
    print(json.dumps(sched, indent=2))
