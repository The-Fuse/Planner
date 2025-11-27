# Deployment Guide

This application is containerized using Docker, making it easy to deploy to any platform that supports Docker containers (e.g., Render, Railway, DigitalOcean, AWS).

## Prerequisites
- Docker and Docker Compose installed on your machine.

## Local Deployment
To run the application locally using Docker:

1.  **Build and Start**:
    ```bash
    docker-compose up --build
    ```
2.  **Access the App**:
    - Frontend: `http://localhost:5173`
    - Backend API: `http://localhost:8000`

## Deploying to Render (Free Tier)

Render is a great option for free hosting. You will deploy the backend and frontend as separate services.

### 1. Backend Service
1.  Create a new **Web Service** on Render.
2.  Connect your GitHub repository.
3.  **Root Directory**: `backend`
4.  **Runtime**: Python 3
5.  **Build Command**: `pip install -r requirements.txt`
6.  **Start Command**: `uvicorn main:app --host 0.0.0.0 --port 10000`
7.  **Environment Variables**:
    - `PYTHON_VERSION`: `3.9.0`

### 2. Frontend Service
1.  Create a new **Static Site** on Render.
2.  Connect your GitHub repository.
3.  **Root Directory**: `frontend`
4.  **Build Command**: `npm install && npm run build`
5.  **Publish Directory**: `dist`
6.  **Rewrite Rules**:
    - Source: `/*`
    - Destination: `/index.html`
    - Action: `Rewrite`

### 3. Connecting Frontend to Backend
In your frontend code (`App.tsx`), the API URL is currently hardcoded to `http://localhost:8000`. For production, you need to update this to point to your deployed backend URL.

**Recommended**: Use an environment variable.
1.  Create `.env` in `frontend`:
    ```
    VITE_API_URL=https://your-backend-service.onrender.com
    ```
2.  Update `App.tsx` to use `import.meta.env.VITE_API_URL`.

## Deploying with Docker (VPS)
If you have a VPS (e.g., DigitalOcean Droplet), you can simply clone the repo and run:
```bash
docker-compose up -d --build
```
The app will be available on port 5173 (frontend) and 8000 (backend).
