from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from scheduler import generate_schedule
from storage import load_progress, save_progress
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load persistent status
completion_status = load_progress()
schedule_cache = generate_schedule()

@app.get("/api/plan")
def get_plan():
    # Enrich with status
    # Note: We might want to re-generate schedule if date changes, 
    # but for now we stick to the cache generated at startup.
    for day in schedule_cache:
        for slot in day['slots']:
            key = f"{day['date']}_{slot['name']}"
            slot['completed'] = completion_status.get(key, False)
    return schedule_cache

@app.post("/api/mark")
def mark_complete(date: str, slot_name: str, completed: bool):
    key = f"{date}_{slot_name}"
    completion_status[key] = completed
    save_progress(completion_status)
    return {"status": "success"}

@app.get("/api/stats")
def get_stats():
    # Calculate stats based on schedule and completion status
    # We need to know total slots per subject and completed slots per subject.
    
    stats = {
        "Polity": {"total": 0, "completed": 0},
        "History": {"total": 0, "completed": 0}
    }
    
    # Iterate through the schedule to count totals
    # And check completion_status for completed count
    
    # We need to be careful: schedule_cache might not have "completed" set correctly 
    # if we only set it in get_plan. But get_plan modifies the objects in place!
    # Let's re-iterate and check completion_status directly using keys.
    
    for day in schedule_cache:
        for slot in day['slots']:
            subj = slot['subject']
            if subj in stats:
                stats[subj]["total"] += 1
                key = f"{day['date']}_{slot['name']}"
                if completion_status.get(key, False):
                    stats[subj]["completed"] += 1
                    
    return stats

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
