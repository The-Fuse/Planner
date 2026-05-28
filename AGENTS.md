This file defines how coding agents should work in this repository.
These instructions apply to the entire repository rooted at this directory.
- `frontend/`: client application
- `backend/`: server application
- `docs/`: project documentation
- Prefer small, focused changes.
- Keep behavior backward-compatible unless explicitly asked otherwise.
- Do not modify unrelated files.
- Update docs when behavior or setup changes.
- Frontend: run install/build/test commands from `frontend/`.
- Backend: run install/build/test commands from `backend/`.
- Use the project’s existing package managers and lockfiles.
- Run the narrowest relevant checks first.
- If full test suites are expensive, run targeted tests and report what was skipped.
- Never run destructive git commands unless explicitly requested.
- Do not commit secrets or environment-specific credentials.
- Summarize what changed and why.
- List files touched.
- Note any remaining risks or follow-up work.
