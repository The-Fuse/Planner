
import datetime
from data import subjects_data

# Configuration
START_DATE = datetime.date(2025, 11, 27)
END_DATE = datetime.date(2025, 12, 31)

# Page Limits
LIMITS = {
    "Morning": 25,
    "Evening": 18,
    "WeekendBlock": 25
}

class SubjectTracker:
    def __init__(self, name, chapters):
        self.name = name
        self.chapters = chapters
        self.current_chapter_idx = 0
        self.current_page = chapters[0]['start'] if chapters else 0
        self.finished = False

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
    # Initialize Trackers
    # Order: Polity, History, Geography, Economy
    # We only have data for Polity and History.
    # Active slots: 1 and 2.
    
    # Pool of subjects in order
    waiting_list = [
        SubjectTracker("Polity", subjects_data["Polity"]),
        SubjectTracker("History", subjects_data["History"]),
        # Placeholders for Geo/Eco if we had data
        # SubjectTracker("Geography", ...),
        # SubjectTracker("Economy", ...)
    ]
    
    # Active subjects
    # Rule: Two subjects EVERY DAY.
    # We take the first two.
    active_slot1 = waiting_list.pop(0) if waiting_list else None
    active_slot2 = waiting_list.pop(0) if waiting_list else None
    
    schedule = []
    
    current_date = START_DATE
    while current_date <= END_DATE:
        day_name = current_date.strftime("%A")
        is_weekend = day_name in ["Saturday", "Sunday"]
        
        day_plan = {
            "date": current_date.isoformat(),
            "day": day_name,
            "slots": []
        }
        
        if not is_weekend:
            # Weekday: Morning (Slot 1), Evening (Slot 2)
            
            # Slot 1
            if active_slot1 and not active_slot1.finished:
                task = active_slot1.get_next_chunk(LIMITS["Morning"])
                if task:
                    day_plan["slots"].append({"name": "Morning", "subject": active_slot1.name, "task": task})
            elif active_slot1 and active_slot1.finished:
                # Replace if finished
                if waiting_list:
                    active_slot1 = waiting_list.pop(0)
                    task = active_slot1.get_next_chunk(LIMITS["Morning"])
                    if task:
                        day_plan["slots"].append({"name": "Morning", "subject": active_slot1.name, "task": task})
                else:
                    day_plan["slots"].append({"name": "Morning", "subject": "Buffer", "task": "Revision"})

            # Slot 2
            if active_slot2 and not active_slot2.finished:
                task = active_slot2.get_next_chunk(LIMITS["Evening"])
                if task:
                    day_plan["slots"].append({"name": "Evening", "subject": active_slot2.name, "task": task})
            elif active_slot2 and active_slot2.finished:
                 # Replace
                if waiting_list:
                    active_slot2 = waiting_list.pop(0)
                    task = active_slot2.get_next_chunk(LIMITS["Evening"])
                    if task:
                        day_plan["slots"].append({"name": "Evening", "subject": active_slot2.name, "task": task})
                else:
                    day_plan["slots"].append({"name": "Evening", "subject": "Buffer", "task": "Revision"})

        else:
            # Weekend: Block 1 (Subj 1), Block 2 (Subj 2), Block 3 (Balance)
            
            # Block 1
            if active_slot1 and not active_slot1.finished:
                task = active_slot1.get_next_chunk(LIMITS["WeekendBlock"])
                if task:
                    day_plan["slots"].append({"name": "Block 1", "subject": active_slot1.name, "task": task})
            
            # Block 2
            if active_slot2 and not active_slot2.finished:
                task = active_slot2.get_next_chunk(LIMITS["WeekendBlock"])
                if task:
                    day_plan["slots"].append({"name": "Block 2", "subject": active_slot2.name, "task": task})
            
            # Block 3 - "whichever subject from 1 or 2 still has remaining pages (or next in replacement order)"
            # Strategy: Pick the one with more chapters left? Or just alternate?
            # Let's pick active_slot1 for simplicity or balance.
            # Or better, check who is "behind" or just default to Slot 2 (History is longer).
            # Let's prioritize History (Slot 2) if it's active, as it has more pages.
            
            target_for_block3 = active_slot2 if (active_slot2 and not active_slot2.finished) else active_slot1
            
            if target_for_block3 and not target_for_block3.finished:
                 task = target_for_block3.get_next_chunk(LIMITS["WeekendBlock"])
                 if task:
                    day_plan["slots"].append({"name": "Block 3", "subject": target_for_block3.name, "task": task})
        
        schedule.append(day_plan)
        current_date += datetime.timedelta(days=1)
        
    return schedule

if __name__ == "__main__":
    import json
    sched = generate_schedule()
    print(json.dumps(sched, indent=2))
