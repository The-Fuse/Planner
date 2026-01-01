import sqlite3
import json
import os
import sys

# Check for DATABASE_URL environment variable (provided by Render/Neon)
DATABASE_URL = os.environ.get('DATABASE_URL')

# Database path for SQLite (fallback)
DB_PATH = os.environ.get('DATABASE_PATH', '/opt/render/project/data/progress.db')
if not os.path.exists(os.path.dirname(DB_PATH)):
    DB_PATH = "progress.db"

def get_db_connection():
    """Get database connection based on configuration"""
    if DATABASE_URL:
        try:
            import psycopg2
        except ImportError:
            print("ERROR: psycopg2 not installed! Install with: pip install psycopg2-binary")
            print("Falling back to SQLite (data will not persist on Render!)")
            conn = sqlite3.connect(DB_PATH)
            return conn, "sqlite"

        try:
            conn = psycopg2.connect(DATABASE_URL)
            print("Successfully connected to PostgreSQL database")
            return conn, "postgres"
        except Exception as e:
            print(f"Failed to connect to PostgreSQL: {e}")
            print("Falling back to SQLite (data will not persist on Render!)")
            conn = sqlite3.connect(DB_PATH)
            return conn, "sqlite"
    else:
        conn = sqlite3.connect(DB_PATH)
        return conn, "sqlite"

def init_db():
    """Initialize the database and create tables if they don't exist"""
    try:
        conn, db_type = get_db_connection()
        cursor = conn.cursor()

        print(f"Initializing database (type: {db_type})...")

        # Create progress table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS progress (
                key VARCHAR(255) PRIMARY KEY,
                completed INTEGER NOT NULL
            )
        ''')

        # Create preferences table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS preferences (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT
            )
        ''')

        conn.commit()
        conn.close()

        print(f"Database initialized successfully (type: {db_type})")

        # Migrate from old progress.json if it exists (only for SQLite local usually)
        if db_type == "sqlite":
            migrate_from_json()

    except Exception as e:
        print(f"Database initialization error: {e}")
        import traceback
        traceback.print_exc()

def migrate_from_json():
    """Migrate data from old progress.json file if it exists"""
    old_file = "progress.json"
    if os.path.exists(old_file):
        try:
            with open(old_file, "r") as f:
                old_data = json.load(f)
            
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
        conn, db_type = get_db_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT key, completed FROM progress')
        rows = cursor.fetchall()

        conn.close()

        # Convert to dictionary with boolean values
        progress_data = {key: bool(completed) for key, completed in rows}
        print(f"Loaded {len(progress_data)} completion records from database (type: {db_type})")
        return progress_data
    except Exception as e:
        print(f"Database error in load_progress: {e}")
        import traceback
        traceback.print_exc()
        return {}

def save_progress(data):
    """Save progress data to database"""
    try:
        conn, db_type = get_db_connection()
        cursor = conn.cursor()

        # Clear existing data and insert new data
        # Note: In a real production app, we might want to UPSERT instead of DELETE ALL
        # but for this simple app, this is fine and ensures consistency
        cursor.execute('DELETE FROM progress')

        # Prepare query based on DB type
        if db_type == "postgres":
            placeholder = "%s"
        else:
            placeholder = "?"

        query = f'INSERT INTO progress (key, completed) VALUES ({placeholder}, {placeholder})'

        for key, completed in data.items():
            cursor.execute(query, (key, 1 if completed else 0))

        conn.commit()
        conn.close()
        print(f"Saved {len(data)} completion records to database (type: {db_type})")
    except Exception as e:
        print(f"Database error in save_progress: {e}")
        import traceback
        traceback.print_exc()

def get_preference(key, default=None):
    """Get a preference value by key"""
    try:
        conn, db_type = get_db_connection()
        cursor = conn.cursor()
        
        if db_type == "postgres":
             cursor.execute('SELECT value FROM preferences WHERE key = %s', (key,))
        else:
             cursor.execute('SELECT value FROM preferences WHERE key = ?', (key,))
             
        row = cursor.fetchone()
        conn.close()
        
        return row[0] if row else default
    except Exception as e:
        print(f"Database error in get_preference: {e}")
        return default

def set_preference(key, value):
    """Set a preference value"""
    try:
        conn, db_type = get_db_connection()
        cursor = conn.cursor()
        
        if db_type == "postgres":
            # UPSERT syntax for Postgres
            cursor.execute('''
                INSERT INTO preferences (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            ''', (key, value))
        else:
            # UPSERT syntax for SQLite
            cursor.execute('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', (key, value))
            
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Database error in set_preference: {e}")
