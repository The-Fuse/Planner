import sys
import traceback
from storage import save_progress

try:
    save_progress({"test": True})
    print("Success")
except Exception as e:
    print(f"Exception: {e}")
    traceback.print_exc()
