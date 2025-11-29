import sqlite3
import json
import os

# Database path - use persistent disk path on Render.com if available
DB_PATH = os.environ.get('DATABASE_PATH', '/opt/render/project/data/progress.db')

# Fallback to local path if Render path doesn't exist (for local development)
if not os.path.exists(os.path.dirname(DB_PATH)):
    DB_PATH = "progress.db"

def init_db():
    """Initialize the database and create tables if they don't exist"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create progress table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS progress (
            key TEXT PRIMARY KEY,
            completed INTEGER NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()
    
    # Migrate from old progress.json if it exists
    migrate_from_json()

def migrate_from_json():
    """Migrate data from old progress.json file if it exists"""
    old_file = "progress.json"
    if os.path.exists(old_file):
        try:
            with open(old_file, "r") as f:
                old_data = json.load(f)
            
            # Only migrate if database is empty
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) FROM progress')
            count = cursor.fetchone()[0]
            
            if count == 0 and old_data:
                print(f"Migrating {len(old_data)} entries from progress.json to database...")
                for key, completed in old_data.items():
                    cursor.execute(
                        'INSERT OR REPLACE INTO progress (key, completed) VALUES (?, ?)',
                        (key, 1 if completed else 0)
                    )
                conn.commit()
                print("Migration completed successfully!")
            
            conn.close()
        except (json.JSONDecodeError, Exception) as e:
            print(f"Migration from progress.json failed: {e}")

def load_progress():
    """Load all progress data from database"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT key, completed FROM progress')
        rows = cursor.fetchall()
        
        conn.close()
        
        # Convert to dictionary with boolean values
        return {key: bool(completed) for key, completed in rows}
    except sqlite3.Error as e:
        print(f"Database error in load_progress: {e}")
        return {}

def save_progress(data):
    """Save progress data to database"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Clear existing data and insert new data
        cursor.execute('DELETE FROM progress')
        
        for key, completed in data.items():
            cursor.execute(
                'INSERT INTO progress (key, completed) VALUES (?, ?)',
                (key, 1 if completed else 0)
            )
        
        conn.commit()
        conn.close()
    except sqlite3.Error as e:
        print(f"Database error in save_progress: {e}")
