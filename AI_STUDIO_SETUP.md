# SkillHub AI Studio Setup

AI Studio adds a persisted course-generation queue to the existing admin dashboard. Generated courses are saved with `pending` status and must be reviewed through the existing admin approval flow before publication. Generation does not change course pricing, payments, enrollments, or instructor earnings.

## Deploy the backend

1. Apply the new database migration with `npm run db:migrate`.
2. Deploy the backend code and generated Prisma client.
3. Configure the environment variables below in the backend host, never in the browser or frontend repository.
4. Grant an admin the `course_manager` role from the admin Roles tab, or grant both `ai_studio:view` and `ai_studio:manage` permissions. The API checks these permissions on every AI Studio route.
5. Open Admin Dashboard > AI Studio. The provider status indicators show which production services are actually configured.

## Course generation provider

The worker uses an OpenAI-compatible chat-completions endpoint and requires a server-side API key:

```env
AI_STUDIO_API_KEY=your-provider-key
AI_STUDIO_BASE_URL=https://api.openai.com/v1
AI_STUDIO_PROVIDER=openai-compatible
AI_STUDIO_MODEL=gpt-4o-mini
```

When setting a monthly budget, also configure rates for the selected model so queued jobs can be cost-estimated and reserved before they run:

```env
AI_STUDIO_MONTHLY_BUDGET_USD=50
AI_STUDIO_INPUT_COST_PER_MILLION=0.15
AI_STUDIO_OUTPUT_COST_PER_MILLION=0.60
```

Use the provider's current prices for these rates. The cost estimate is a budget guard, not a provider invoice; actual usage and available provider token counts are recorded after a response. Without an API key, course generation is disabled and the dashboard says why.

## Additional services

The following environment variables currently report readiness only; a value does not create an integration by itself:

```env
AI_STUDIO_VIDEO_API_KEY=
AI_STUDIO_VOICE_API_KEY=
AI_STUDIO_STORAGE_BUCKET=
```

Video recording/automation, voice narration, PDF file generation, persistent asset storage, presentations, and automated quality review are not implemented as provider integrations yet. The dashboard identifies them as unavailable and does not create fake completed assets. Configure a vetted provider integration and storage adapter before treating those production sections as operational.

## Operational notes

- Jobs and usage are persisted in PostgreSQL; queued jobs survive refreshes and worker restarts.
- The worker runs in the backend process. For multiple backend replicas, use a dedicated worker deployment or a shared queue with leases/locking before scaling workers horizontally.
- Generated course content is AI-assisted and requires human review for accuracy, safety, and suitability.
- Existing course approval publishes the draft using the current SkillHub catalog workflow.