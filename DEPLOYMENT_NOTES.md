# Deployment Notes for Render.com

## Data Persistence Fix (Free Tier)

This application supports both **SQLite** (local development) and **PostgreSQL** (production). 
Since Render.com's persistent disk is a paid feature, we recommend using a **free external PostgreSQL database** like **Neon.tech**.

## Setup Instructions

### 1. Get a Free PostgreSQL Database

1. Go to [Neon.tech](https://neon.tech) and sign up (it's free).
2. Create a new project.
3. Copy the **Connection String** (it looks like `postgres://user:password@host/dbname?sslmode=require`).

### 2. Configure Render.com

1. Go to your Render.com dashboard and select your service.
2. Navigate to **Environment**.
3. Add a new Environment Variable:
   - **Key**: `DATABASE_URL`
   - **Value**: (Paste your Neon connection string here)
4. Save changes. Render will automatically redeploy.

### 3. Verify

1. After deployment, the application will detect the `DATABASE_URL` and switch to PostgreSQL mode.
2. Mark a task as complete.
3. Restart the server (or wait for it to sleep).
4. Verify the task remains completed.

## Local Development

For local development, simply run the app as usual. It will automatically fallback to using `progress.db` (SQLite) if no `DATABASE_URL` is present.

## Migration

- **Note**: Data from `progress.json` or local `progress.db` is **NOT** automatically migrated to the remote PostgreSQL database. You start fresh on production.
- If you need to migrate data, you would need to manually run a script to insert data into the remote database.

## Troubleshooting

### Connection Errors
- Ensure the `DATABASE_URL` is correct and includes `sslmode=require` (Neon usually adds this by default).
- Check Render logs for "Failed to connect to PostgreSQL" messages.

### Data Not Persisting
- Verify `DATABASE_URL` is set in Environment variables.
- If not set, the app falls back to SQLite in the ephemeral file system (which loses data on restart).
