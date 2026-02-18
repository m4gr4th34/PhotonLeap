# Optics Trace API

FastAPI backend for optical ray-tracing. The React frontend sends `optical_stack` JSON; the backend runs rayoptics and returns (z,y) coordinates for rays and lens surface curves.

## Setup

```bash
# From project root
pip install fastapi "uvicorn[standard]"
# or: pip install -r requirements.txt
```

## Run

```bash
# From project root
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints

- `POST /api/trace` — Run ray trace. Body: `{ surfaces, entrancePupilDiameter, wavelengths, fieldAngles, numRays }`
- `GET /api/health` — Health check

## Response

```json
{
  "rays": [[[z,y], [z,y], ...], ...],
  "surfaces": [[[z,y], [z,y], ...], ...],
  "focusZ": 100.5,
  "performance": { "rmsSpotRadius": 0.01, "totalLength": 100, "fNumber": 10 }
}
```

## Frontend

Set `VITE_API_URL=http://localhost:8000` (default) or your API URL. The web app calls the trace API when you click **Trace** in the Lens Designer view.
