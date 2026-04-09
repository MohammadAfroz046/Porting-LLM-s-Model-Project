
// chat/utils/rag/vectorStore.ts

import RNFS from 'react-native-fs';
import { Chunk } from './chunker';

function getIndexPath(profileId: string): string {
    return `${RNFS.ExternalDirectoryPath}/profiles/${profileId}/rag_index.json`;
}
export interface VectorEntry {
    chunk: Chunk;
    vector: number[]; // stored as number[] in JSON, converted to Float32Array on load
}

export interface VectorIndex {
    entries: VectorEntry[];
    createdAt: string;
    updatedAt: string;
}

// Bug #7 fix: per-profile in-memory indexes instead of a single global
let inMemoryIndexes: Record<string, { chunk: Chunk; vector: Float32Array }[]> = {};

/** Get the in-memory index for a profile, initializing if needed. */
function getIndex(profileId: string): { chunk: Chunk; vector: Float32Array }[] {
    if (!inMemoryIndexes[profileId]) {
        inMemoryIndexes[profileId] = [];
    }
    return inMemoryIndexes[profileId];
}

// ─── Cosine Similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function saveIndex(profileId: string): Promise<void> {
    const entries = getIndex(profileId);
    const index: VectorIndex = {
        entries: entries.map(e => ({
            chunk: e.chunk,
            vector: Array.from(e.vector), // Float32Array → number[] for JSON
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const dir = `${RNFS.ExternalDirectoryPath}/profiles/${profileId}`;
    const dirExists = await RNFS.exists(dir);
    if (!dirExists) {
        await RNFS.mkdir(dir);
    }

    const indexPath = getIndexPath(profileId);
    await RNFS.writeFile(indexPath, JSON.stringify(index), 'utf8');
}

export async function loadIndex(profileId: string): Promise<void> {
    const indexPath = getIndexPath(profileId);
    const exists = await RNFS.exists(indexPath);
    if (!exists) {
        inMemoryIndexes[profileId] = [];
        return;
    }

    const raw = await RNFS.readFile(indexPath, 'utf8');
    const index: VectorIndex = JSON.parse(raw);

    // Convert number[] back to Float32Array for performance
    inMemoryIndexes[profileId] = index.entries.map(e => ({
        chunk: e.chunk,
        vector: new Float32Array(e.vector),
    }));
}

export async function clearIndex(profileId: string): Promise<void> {
    inMemoryIndexes[profileId] = [];
    const indexPath = getIndexPath(profileId);
    const exists = await RNFS.exists(indexPath);
    if (exists) await RNFS.unlink(indexPath);
}

export function flushInMemoryIndex(profileId?: string): void {
    if (profileId) {
        delete inMemoryIndexes[profileId];
    } else {
        // Flush all profiles (used during full logout)
        inMemoryIndexes = {};
    }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Add a batch of chunk+vector pairs to the index.
 */
export async function addToIndex(
    chunks: Chunk[],
    vectors: Float32Array[],
    profileId: string
): Promise<void> {
    const index = getIndex(profileId);
    for (let i = 0; i < chunks.length; i++) {
        index.push({ chunk: chunks[i], vector: vectors[i] });
    }
    await saveIndex(profileId);
}

/**
 * Remove all entries belonging to a specific document.
 */
export async function removeDocFromIndex(docId: string, profileId: string): Promise<void> {
    inMemoryIndexes[profileId] = getIndex(profileId).filter(e => e.chunk.docId !== docId);
    await saveIndex(profileId);
}

/**
 * Get all unique document IDs in the index.
 */
export function getIndexedDocIds(profileId: string): string[] {
    const ids = new Set(getIndex(profileId).map(e => e.chunk.docId));
    return Array.from(ids);
}

/**
 * Get total number of vectors in index.
 */
export function getIndexSize(profileId?: string): number {
    if (profileId) {
        return getIndex(profileId).length;
    }
    // Sum across all loaded profiles
    return Object.values(inMemoryIndexes).reduce((sum, idx) => sum + idx.length, 0);
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
    chunk: Chunk;
    score: number;
}

/**
 * Find the top-k most similar chunks to a query vector.
 * Bug #8, #19 fix: now scoped to a specific profile's index.
 */
export function search(
    queryVector: Float32Array,
    profileId: string,
    topK: number = 3
): SearchResult[] {
    const index = getIndex(profileId);
    if (index.length === 0) return [];

    const scored = index.map(entry => ({
        chunk: entry.chunk,
        score: cosineSimilarity(queryVector, entry.vector),
    }));

    // Sort descending by similarity score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
}