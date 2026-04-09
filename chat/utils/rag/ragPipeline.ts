
// chat/utils/rag/ragPipeline.ts

import { chunkText, Chunk } from './chunker';
import { embedText, embedBatch } from './embedder';
import {
    addToIndex,
    removeDocFromIndex,
    loadIndex,
    search,
    SearchResult,
} from './vectorStore';
import RNFS from 'react-native-fs';

// ─── Document Ingestion ───────────────────────────────────────────────────────

export interface IngestOptions {
    onProgress?: (stage: string, done: number, total: number) => void;
}

/**
 * Ingest a plain text document into the RAG index.
 */
export async function ingestTextDoc(
    text: string,
    docId: string,
    docName: string,
    profileId: string,
    options?: IngestOptions
): Promise<{ chunkCount: number }> {
    const { onProgress } = options || {};

    // Step 1: Chunk
    onProgress?.('Chunking...', 0, 1);
    const chunks: Chunk[] = chunkText(text, docId, docName);

    if (chunks.length === 0) {
        throw new Error('Document produced no chunks. It may be too short or empty.');
    }

    // Step 2: Embed all chunks
    const texts = chunks.map(c => c.text);
    const vectors = await embedBatch(
        texts,
        profileId,
        (done, total) => {
            onProgress?.('Embedding...', done, total);
        }
    );

    // Step 3: Add to index
    onProgress?.('Saving index...', 0, 1);
    await addToIndex(chunks, vectors, profileId);
    onProgress?.('Done', 1, 1);

    return { chunkCount: chunks.length };
}

/**
 * Remove a document from the index by its ID.
 */
export async function removeDoc(docId: string, profileId: string): Promise<void> {
    await removeDocFromIndex(docId, profileId);
}

/**
 * Load the persisted index into memory (call on app start).
 */
export async function initRAG(profileId: string): Promise<void> {
    await loadIndex(profileId);
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Given a user query, retrieve the top-k relevant chunks and
 * return them as a formatted context string for the LLM prompt.
 */
export async function retrieveContext(
    query: string,
    profileId: string,
    topK: number = 3
): Promise<string | null> {
    const queryVector = await embedText(query, profileId);
    // Bug #8 fix: pass profileId to search() for proper profile isolation
    const results: SearchResult[] = search(queryVector, profileId, topK);

    if (results.length === 0) return null;

    // Vector search dynamic thresholding handles the bounds now for relevant chunks.
    const relevant = results;
    
    if (relevant.length === 0) return null;

    // Format context for LLM prompt injection
    const context = relevant
        .map((r, i) => `[${i + 1}] (from "${r.chunk.docName}")\n${r.chunk.text}`)
        .join('\n\n');

    return context;
}