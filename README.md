 

**Welcome to your Base44 project** 

**About**

View and Edit  your app on [Base44.com](http://Base44.com) 

This project contains everything you need to run your app locally.

**Edit the code in your local development environment**

Any change pushed to the repo will also be reflected in the Base44 Builder.

**Prerequisites:** 

1. Clone the repository using the project's Git URL 
2. Navigate to the project directory
3. Install dependencies: `npm install`
4. Create an `.env.local` file and set the right environment variables

```
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url

e.g.
VITE_BASE44_APP_ID=cbef744a8545c389ef439ea6
VITE_BASE44_APP_BASE_URL=https://my-to-do-list-81bfaad7.base44.app
```

Run the app: `npm run dev`

If you see `[base44] Proxy not enabled (VITE_BASE44_APP_BASE_URL not set)`, it means your `.env.local` is missing `VITE_BASE44_APP_BASE_URL`.

**Local backend (Node + Postgres)**

This repo can also run with a local backend for `Employee` and `TimesheetRecord`.

1. Start Postgres: `docker compose up -d db`
2. Start backend:

   - `cd backend`
   - `npm install`
   - `npm run dev`

3. In the frontend `.env.local`, set:

   - `VITE_USE_LOCAL_BACKEND=true`
   - `VITE_LOCAL_BACKEND_URL=http://localhost:3001`

Note: The local backend now implements the Base44-style integrations used in `UploadPage`:

- `UploadFile`: saves the uploaded file under `backend/uploads` and returns a `file_url`
- `ExtractDataFromUploadedFile`: extracts daily timesheet rows from the `TimeSheet` sheet
- `InvokeLLM`: returns the parsed JSON payload for the UI (local deterministic parser)

For Excel extraction on Windows, the backend will use (in this order):
1) the optional `xlsx` npm package if installed, otherwise
2) Excel via COM automation (requires Microsoft Excel installed).

**Run with Docker (optional)**

1. Install/start Docker Desktop (Windows/macOS) or Docker Engine (Linux)
2. Create a `.env` (or export env vars) based on `.env.example`
3. Run: `docker compose up --build`

**Database in Docker (optional)**

This repo is a Base44 frontend (there is no backend code here). If you still want a local database container (for a separate backend), the `docker-compose.yml` includes a Postgres service named `db`.

- Start only the DB: `docker compose up -d db`
- Check logs: `docker compose logs -f db`
- Stop: `docker compose down`

**Publish your changes**

Open [Base44.com](http://Base44.com) and click on Publish.

**Docs & Support**

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Support: [https://app.base44.com/support](https://app.base44.com/support)
