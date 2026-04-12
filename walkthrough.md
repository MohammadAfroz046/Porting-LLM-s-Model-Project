# Sundae RAG Pipeline — Technical Walkthrough

A comprehensive explanation of how Retrieval-Augmented Generation (RAG) is implemented in the Sundae mobile app, how it works fully offline, and the architectural decisions behind it.

---

## What is RAG and Why Do We Need It?

Sundae runs a **local LLM** on the user's phone. The problem is: local LLMs are small (typically 1–3B parameters) and only know what they learned during training. They can't answer questions about the user's personal documents, notes, or PDFs.

**RAG solves this** by:
1. Pre-processing the user's documents into searchable chunks
2. When the user asks a question, finding the most relevant chunks
3. Injecting those chunks into the LLM prompt as "context"
4. Instructing the LLM to answer **only** from that context

This gives a small offline model the ability to answer questions about any document the user uploads — without fine-tuning, internet access, or cloud APIs.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    SUNDAE MOBILE APP                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐     ┌─────────────┐                     │
│  │  Documents   │     │    Chat     │                     │
│  │   Screen     │     │   Screen    │                     │
│  └──────┬───────┘     └──────┬──────┘                     │
│         │ upload              │ query                     │
│         ▼                     ▼                           │
│  ┌─────────────────────────────────────┐                  │
│  │         RAG Pipeline                │                  │
│  │  ┌──────────┐  ┌──────────────────┐ │                  │
│  │  │ Chunker  │  │  Retriever       │ │                  │
│  │  │ (split)  │  │  (search+filter) │ │                  │
│  │  └────┬─────┘  └────────┬─────────┘ │                  │
│  │       ▼                 ▼           │                  │
│  │  ┌──────────────────────────────┐   │                  │
│  │  │    Embedder (llama.rn)       │   │                  │
│  │  │  GGUF embedding model        │   │                  │
│  │  └────────────┬─────────────────┘   │                  │
│  │               ▼                     │                  │
│  │  ┌──────────────────────────────┐   │                  │
│  │  │    Vector Store (JSON file)  │   │                  │
│  │  │  cosine similarity search    │   │                  │
│  │  └──────────────────────────────┘   │                  │
│  └─────────────────────────────────────┘                  │
│                                                          │
│  ┌─────────────────────────────────────┐                  │
│  │         Chat LLM (llama.rn)         │                  │
│  │    GGUF chat model for generation   │                  │
│  └─────────────────────────────────────┘                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Models Used

### 1. Embedding Model (for vectorization)
- **Format:** GGUF (quantized)
- **Purpose:** Converts text chunks and queries into numerical vectors (embeddings)
- **Runtime:** `llama.rn` with the `embedding: true` flag
- **Context window:** 512 tokens
- **GPU:** Disabled (runs on CPU for compatibility)
- **Selection:** The user downloads and selects an embedding model per-profile via the Models screen. The model ID is stored in AsyncStorage under the key `{profileId}_embedding_model`

### 2. Chat/Generation Model (for answering)
- **Format:** GGUF (quantized)
- **Purpose:** Generates natural language responses given a prompt
- **Runtime:** `llama.rn` in standard completion mode
- **Context window:** 512 tokens
- **Selection:** The user downloads and selects a chat model per-profile. Stored under key `{profileId}_selected_model`

> **Key point:** Both models run 100% on-device via `llama.rn`, which is a React Native binding for `llama.cpp`. No internet required after the models are downloaded.

---

## How It Works Offline

Everything in this pipeline runs locally:

| Component | Technology | Storage |
|-----------|-----------|---------|
| Document text extraction | `react-native-fs` (txt) / `react-native-pdf-extractor` (pdf) | In-memory |
| Text chunking | Pure JavaScript string processing | In-memory |
| Embedding generation | `llama.rn` with a local GGUF model | In-memory |
| Vector storage | JSON file on device filesystem | `{ExternalDir}/profiles/{id}/rag_index.json` |
| Vector search | Cosine similarity in pure JavaScript | In-memory |
| Text generation | `llama.rn` with a local GGUF model | In-memory |
| Metadata | AsyncStorage (key-value) | App's internal storage |

**No network calls are made at any point** in the RAG pipeline. The user downloads models once (when they have internet), and after that everything works in airplane mode.

---

## Workflow 1: Document Ingestion (Upload Flow)

This happens when the user taps "Upload Document" on the Documents screen.

```
┌──────────────┐
│ User taps    │
│ "Upload Doc" │
└──────┬───────┘
       ▼
┌──────────────┐     Supported: .txt, .pdf
│ File Picker  │     Uses @react-native-documents/picker
└──────┬───────┘
       ▼
┌──────────────┐     .txt → RNFS.readFile()
│ Text Extract │     .pdf → react-native-pdf-extractor
└──────┬───────┘
       ▼
┌──────────────┐     150 words per chunk
│  Chunking    │     30 words overlap between chunks
│              │     Minimum 10 words per chunk (filters tiny tail chunks)
└──────┬───────┘
       ▼
┌──────────────┐     Each chunk → embedding model → Float32Array vector
│  Embedding   │     Processed sequentially (batch of 1)
│  (batch)     │     Progress callback updates UI
└──────┬───────┘
       ▼
┌──────────────┐     Appends to in-memory index
│ Vector Store │     Persists to rag_index.json on disk
│  (save)      │     Each entry = { chunk metadata, vector }
└──────┬───────┘
       ▼
┌──────────────┐
│ Doc metadata │     Saved to AsyncStorage: name, ID, chunk count, date
│  saved       │
└──────────────┘
```

### Chunking Strategy

- **Chunk size:** 150 words per chunk
- **Overlap:** 30 words (each chunk shares 30 words with the previous one)
- **Why overlap?** Ensures that if a relevant sentence falls on a chunk boundary, it still appears in full in at least one chunk
- **Minimum chunk size:** 10 words — very small tail chunks at the end of a document are discarded because they're too short to be meaningful
- **Word-based, not token-based:** We split on whitespace, not on LLM tokens. This is simpler and good enough for the use case

### Vector Storage

The vector index is stored as a JSON file at:
```
/storage/emulated/0/Android/data/{app}/files/profiles/{profileId}/rag_index.json
```

Structure:
```
{
  "entries": [
    {
      "chunk": { "text": "...", "docId": "doc_123", "chunkIndex": 0, "docName": "notes.txt" },
      "vector": [0.12, -0.45, 0.78, ...]   // number[] (converted from Float32Array)
    },
    ...
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

On load, `number[]` arrays are converted back to `Float32Array` for efficient similarity computation.

---

## Workflow 2: Query Flow (Chat)

This happens when the user sends a message in the Chat screen.

```
┌──────────────┐
│ User sends   │
│ "What is X?" │
└──────┬───────┘
       ▼
┌──────────────┐     Keyword matching against raw user query ONLY
│ Task Router  │     Checks: alarm? calendar? call? open app?
│              │     If none match → routes to QA handler
└──────┬───────┘
       ▼  (QA path)
┌──────────────┐
│ QA Handler   │
│  (qa.ts)     │
└──────┬───────┘
       ▼
┌──────────────┐     Same embedding model used during ingestion
│ Embed Query  │     "What is X?" → Float32Array vector
└──────┬───────┘
       ▼
┌──────────────┐     Cosine similarity against all stored vectors
│ Vector Search│     Returns top 3 most similar chunks
│ (top-k = 3)  │
└──────┬───────┘
       ▼
┌──────────────┐     Minimum cosine similarity: 0.3
│  Threshold   │     Chunks below 0.3 are discarded as irrelevant
│  Filter      │     If all chunks filtered → no RAG context used
└──────┬───────┘
       ▼
┌──────────────────────────────────────────────────┐
│ Prompt Construction                              │
│                                                  │
│ IF relevant chunks found:                        │
│   System: "Answer ONLY from the context below.   │
│            Context: [chunk1] [chunk2] ..."        │
│   User: "What is X?"                             │
│                                                  │
│ IF no relevant chunks:                           │
│   System: "You are Sundae, a helpful assistant." │
│   User: "What is X?"                             │
└──────────────────┬───────────────────────────────┘
                   ▼
            ┌──────────────┐
            │  Chat LLM    │     n_predict: 512 tokens max
            │  (llama.rn)  │     temperature: 0.7
            │  completion   │     top_p: 0.9
            └──────┬───────┘
                   ▼
            ┌──────────────┐
            │ Word-by-word │     Displayed with typing animation
            │  display     │     60-100ms per word
            └──────────────┘
```

### Why RAG Retrieval Happens Inside QA (Not in ChatScreen)

This was a critical architectural decision (and a bug fix). Previously, RAG context was injected into the user message **before** the task router saw it. This caused problems:

- The task router does keyword matching ("today", "schedule", "call", "alarm", etc.)
- If a document contained any of those words, the router would **misroute** the query to the wrong handler (e.g., calendar instead of QA)
- The specialized handlers (calendar, alarm, etc.) would completely ignore the RAG context

**Solution:** RAG retrieval now happens **inside** the QA handler, after routing. The task router only ever sees the clean user query.

---

## Per-Profile Data Isolation

Every piece of RAG data is scoped to a profile:

| Data | Profile Isolation |
|------|------------------|
| Vector index (in-memory) | `inMemoryIndexes[profileId]` — separate array per profile |
| Vector index (on disk) | `profiles/{profileId}/rag_index.json` — separate file per profile |
| Embedding model context | `embeddingContexts[profileId]` — separate llama context per profile |
| Document metadata | AsyncStorage key `{profileId}_docs_meta` |
| Embedding model selection | AsyncStorage key `{profileId}_embedding_model` |

When a user switches profiles:
1. The old profile's in-memory vectors are flushed
2. The old profile's embedding model context is released
3. The new profile's vector index is loaded from disk
4. The new profile's embedding model is initialized

This prevents any cross-contamination between profiles.

---

## Similarity Search

The search uses **cosine similarity** — a standard measure of how "close" two vectors are in meaning-space:

- **Score 1.0** = identical meaning
- **Score 0.0** = completely unrelated
- **Score -1.0** = opposite meaning (rare in practice)

### Threshold

A minimum similarity threshold of **0.3** is applied. This means:
- If the user asks something completely unrelated to any uploaded document, no context is injected
- The LLM falls back to answering from its own knowledge
- This prevents garbage/irrelevant chunks from confusing the model

### Top-K

By default, the top **3** most similar chunks are returned. This is a balance between:
- **Too few** (1): might miss relevant context scattered across chunks
- **Too many** (10+): bloats the prompt and may exceed the model's context window

---

## Debug Logging

The pipeline logs at key points (visible via `adb logcat`):

| Tag | What It Shows |
|-----|---------------|
| `[RAG] Search results:` | Score, document name, and preview for each candidate chunk |
| `[RAG] After threshold filter:` | How many chunks survived the 0.3 similarity threshold |
| `[QA] RAG context retrieved:` | Whether context was found and its size in characters |
| `[QA] RAG retrieval failed:` | Any error during the retrieval process |

---

## File Map

```
chat/
├── utils/
│   ├── rag/
│   │   ├── chunker.ts        — Text splitting (150 words, 30 overlap)
│   │   ├── embedder.ts       — Embedding model init + text→vector conversion
│   │   ├── ragPipeline.ts    — Orchestrator: ingest, retrieve, init
│   │   └── vectorStore.ts    — In-memory index, cosine search, JSON persistence
│   ├── taskRouter.ts         — Routes user queries to appropriate handler
│   ├── ProfileContext.tsx    — Initializes RAG + embedding on profile switch
│   └── profileManager.ts    — Profile CRUD, data isolation keys
├── tasks/
│   └── qa.ts                 — QA handler: RAG retrieval + LLM prompt construction
└── screens/
    ├── ChatScreen.tsx        — User interface for chat
    └── DocumentsScreen.tsx   — Upload/manage documents
```
