# Mistral SDK Feature Opportunities

## Why it matters for VibeCoursing
- Deliver real-time, streaming answers so learners see guidance materialise as it’s generated.
- Unlock richer study materials by letting learners upload documents, audio, or slides directly into the assistant.
- Keep knowledge fresh with live web answers instead of relying on static prompts.
- Centralise reusable course content in document libraries so agents can reuse curated sources across cohorts.

## File ingestion & management
**What you can build**
- Student or teacher upload flows that accept PDFs, notes, or datasets.
- Automated preprocessing (OCR, summarisation) triggered after an upload completes.
- Download portals or signed URLs so learners can recover generated artefacts.

**Key endpoints**
- `files.upload` – create new files from streams or buffers.
- `files.list` / `files.retrieve` – show and inspect uploads per user or class.
- `files.download` – stream raw bytes for storage or post-processing.
- `files.getSignedUrl` – hand out time-limited download links without proxying data.

**TypeScript example – uploading & indexing a file**
```ts
import { Mistral } from "@mistralai/mistralai";
import { openAsBlob } from "node:fs";

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY ?? "" });

export async function ingestFile(filePath: string) {
  const uploaded = await client.files.upload({
    file: await openAsBlob(filePath),
  });

  const signedUrl = await client.files.getSignedUrl({ fileId: uploaded.id });

  return { fileId: uploaded.id, signedUrl: signedUrl.url };
}
```

## Document libraries for reusable knowledge
**What you can build**
- Curated course packs that agents can reference repeatedly.
- Tiered access: map libraries to cohorts, instructors, or premium plans.
- Automated library refresh (daily syllabus updates, scraped articles).

**Workflow outline**
1. Create or lookup a library with `client.beta.libraries.create` / `list`.
2. Upload processed files via `client.beta.libraries.documents.upload`.
3. Attach the library to a specialised agent:
   ```ts
   const libraryAgent = await client.beta.agents.create({
     model: "mistral-medium-latest",
     name: "Course Librarian",
     instructions: "Consult the document library before answering.",
     tools: [{ type: "document_library", libraryIds: [libraryId] }],
   });
   ```
4. Route learner questions through `client.agents.complete` or streaming completions.

## Live web search & browsing
**What you can build**
- “What changed since last lecture?” queries powered by current web data.
- Inline fact-checking: display the search snippets alongside answers.
- Premium browsing: toggle between standard `web_search` and `web_search_premium` tools.

**Agent creation example**
```ts
const webAgent = await client.beta.agents.create({
  model: "mistral-medium-latest",
  name: "News Scout",
  description: "Finds fresh information for course discussions.",
  instructions: "Use web search when facts may have changed.",
  tools: [{ type: "web_search" }],
});
```

**Streaming a response with live search context**
```ts
const stream = await client.agents.stream({
  agentId: webAgent.id,
  messages: [{ role: "user", content: "Summarise today’s AI policy headlines." }],
});

for await (const event of stream) {
  // Surface partial answers or web citations in the UI here.
}
```

## Suggested next steps
1. Wire a file-upload UI to `ingestFile` and persist returned `fileId` + metadata.
2. Schedule a nightly job that syncs curated URLs into a document library for evergreen topics.
3. Ship a beta “Browse the web” mode that routes queries through the web-search-enabled agent and surfaces citations.
4. Add analytics around tool usage (uploads, web searches) to refine UX and identify premium upsell moments.
