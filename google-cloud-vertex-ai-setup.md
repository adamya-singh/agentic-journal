# Google Vertex AI setup (billing to existing GCP credits)

This project is configured to route Gemini/Veo usage through **Vertex AI** so charges hit our GCP billing account (covered by existing credits). Follow these steps to replicate in another project.

## 1) Prerequisites in Google Cloud
- Use the GCP project that holds the credits and has billing enabled.
- Enable **Vertex AI API** in that project.
- Create a **service account** for the app and grant it the minimum roles for Vertex AI GenAI usage (e.g., `roles/aiplatform.user`; add storage roles only if you store assets in GCS).

## 2) Service account key (local/dev)
- Create a JSON key for the service account (for local or non-GCP hosting). Rotate regularly.
- Save the full JSON into the env var `GCP_SERVICE_ACCOUNT_KEY` (stringified JSON).
- Do **not** commit the key; use a secrets manager in real deployments.

## 3) Required environment variables
Set these where the app runs (local `.env`, hosting secrets, CI):
- `GCP_PROJECT_ID` — the project with credits/billing.
- `GCP_LOCATION` — region for models (we default to `us-central1`).
- `GCP_SERVICE_ACCOUNT_KEY` — JSON for the service account (only needed when not using ADC on GCP).

## 4) SDK client configuration (code)
File: `ai-video-gen/src/lib/ai/vertex-client.ts`
- Uses **Google Gen AI SDK** in Vertex mode:
  - `vertexai: true`
  - `project: GCP_PROJECT_ID`
  - `location: GCP_LOCATION`
  - `googleAuthOptions.credentials` from `GCP_SERVICE_ACCOUNT_KEY`
- Models we call:
  - Images: `gemini-2.5-flash-image` (a.k.a. Nano Banana)
  - Video: `veo-3.0-generate-preview` (Veo 3)

## 5) How to run locally
1) Ensure the env vars above are set.
2) Install deps: `pnpm install` (or npm/yarn).
3) Run the app as usual; Vertex AI requests will authenticate via the provided service account key and bill the specified project.

## 6) Production auth option (preferred)
- If running on GCP (Cloud Run/GKE/Compute), use **Application Default Credentials (ADC)** by attaching the service account to the workload.
- In that case, you can omit `GCP_SERVICE_ACCOUNT_KEY`; ADC will supply credentials and still bill the same project.

## 7) Why this bills our credits
- Setting `vertexai: true` + `project` ensures calls go through Vertex AI in the chosen project.
- Vertex AI billing is tied to the project’s billing account, so usage draws from that project’s credits (unlike the standalone Gemini Developer API path).

## 8) Quick verification checklist
- `Vertex AI API` enabled in the target project.
- Service account exists with Vertex permissions.
- `GCP_PROJECT_ID` matches the credited project; `GCP_LOCATION` set.
- Local/non-GCP: `GCP_SERVICE_ACCOUNT_KEY` present and parseable JSON.
- Calls return 200 and appear in Cloud Console > Vertex AI > Monitoring/Billing.

## 9) Troubleshooting
- 403/permission: check service account role and that you’re hitting the correct project/region.
- Invalid JSON: ensure `GCP_SERVICE_ACCOUNT_KEY` is valid, escaped JSON.
- Model not found: verify regional availability and access for `gemini-2.5-flash-image` / `veo-3.0-generate-preview`.
- Charges not on credits: confirm requests are routed via Vertex (not Gemini Dev API) and the project has billing enabled.