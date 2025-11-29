# Deployment Notes for Render.com

## Data Persistence Fix

This application now uses SQLite database instead of JSON files for storing task completion status. This ensures data persists across server restarts.

## Render.com Configuration

### Option 1: Using Persistent Disk (Recommended)

1. **Add a Persistent Disk** to your Render service:
   - Go to your service dashboard on Render.com
   - Navigate to "Disks" section
   - Click "Add Disk"
   - Set mount path: `/opt/render/project/data`
   - Set size: 1GB (minimum needed)
   - Save changes

2. **Redeploy** your service after adding the disk

3. The application will automatically use the persistent disk path for the database

### Option 2: Using Environment Variable (Alternative)

If you prefer a different path for the database:

1. Add an environment variable in Render.com:
   - Key: `DATABASE_PATH`
   - Value: `/path/to/your/persistent/disk/progress.db`

2. Ensure the path points to a persistent disk mount

### Local Development

For local development, the application automatically falls back to using `progress.db` in the current directory. No configuration needed.

## Migration from Old Deployment

If you have an existing deployment with `progress.json`:

1. The application will automatically migrate data from `progress.json` to the SQLite database on first run
2. After successful migration, you can safely delete the old `progress.json` file
3. The migration only happens once (when the database is empty)

## Verification

After deployment:

1. Mark a few tasks as complete
2. Manually restart your service (or wait for automatic restart)
3. Check that completed tasks remain marked as complete
4. You should see a `progress.db` file in your persistent disk location

## Troubleshooting

### Database file not persisting

- Verify the persistent disk is properly mounted at `/opt/render/project/data`
- Check Render logs for any database-related errors
- Ensure the disk has write permissions

### Migration not working

- Check if `progress.json` exists in the backend directory
- Look for migration messages in the server logs
- Manually verify the database using SQLite browser tools if needed

## Database Schema

The SQLite database has a simple schema:

```sql
CREATE TABLE progress (
    key TEXT PRIMARY KEY,      -- Format: "YYYY-MM-DD_SlotName"
    completed INTEGER NOT NULL -- 1 for completed, 0 for not completed
)
```

## Backup Recommendations

Since the database is stored on a persistent disk:

1. Render.com automatically backs up persistent disks
2. For additional safety, consider periodic exports of the database
3. You can query the database directly using SQLite tools if needed
