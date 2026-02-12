
import datetime
import json
from scheduler import generate_schedule, subjects_data

sched = generate_schedule()
# Find finish dates
finishes = {}
for d in sched:
    for s in d['slots']:
        if s['subject'] not in finishes:
            # We want to find the LAST day it appeared
            pass
    # Better: just track last seen
    for s in d['slots']:
        finishes[s['subject']] = d['date']

print("Subject Finish Dates:")
for subj, date in finishes.items():
    print(f"  - {subj}: {date}")

# Just print Feb 9 to Feb 25
print("\nSchedule Excerpt:")
for d in sched:
    # 2026-02-09 to 2026-02-25
    if "2026-02-09" <= d["date"] <= "2026-02-25":
        print(f"{d['date']} ({d['day']}):")
        for s in d['slots']:
            print(f"  - {s['name']}: {s['subject']} -> {s['task'][:50]}...")
        if not d['slots']:
            print("  - EMPTY")
