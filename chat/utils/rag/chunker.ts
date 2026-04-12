// chat/utils/rag/chunker.ts

export interface Chunk {
  text: string;
  docId: string;
  chunkIndex: number;
  docName: string;
}

const CHUNK_SIZE = 100;   // words per chunk
const CHUNK_OVERLAP = 20; // overlapping words between chunks

/**
 * Splits raw text into overlapping word-based chunks.
 */
export function chunkText(
  text: string,
  docId: string,
  docName: string
): Chunk[] {
  // Normalize whitespace
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(w => w.length > 0);

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    const chunkWords = words.slice(start, end);

    // Skip very short chunks (less than 10 words) at end of doc
    if (chunkWords.length >= 10) {
      chunks.push({
        text: chunkWords.join(' '),
        docId,
        chunkIndex: chunks.length,
        docName,
      });
    }

    // Move forward by CHUNK_SIZE - CHUNK_OVERLAP for overlap
    start += CHUNK_SIZE - CHUNK_OVERLAP;

    // Safety: if we're near the end and overlap would cause infinite loop
    if (end === words.length) break;
  }

  return chunks;
}