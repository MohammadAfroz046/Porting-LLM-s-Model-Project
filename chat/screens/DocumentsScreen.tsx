// chat/screens/DocumentsScreen.tsx

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ingestTextDoc, removeDoc } from '../utils/rag/ragPipeline';
import { getIndexSize } from '../utils/rag/vectorStore';
import { useProfile } from '../utils/ProfileContext';
import { profileKey } from '../utils/profileManager';

interface DocMeta {
  id: string;
  name: string;
  addedAt: string;
  chunkCount: number;
}

const DocumentsScreen = () => {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState('');
  const [indexSize, setIndexSize] = useState(0);
  const [embeddingReady, setEmbeddingReady] = useState(false);
  const { profileId } = useProfile();

  // Bug #12 fix: compute key dynamically so it never goes stale
  const getDocsMetaKey = useCallback(() => {
    return profileId ? profileKey(profileId, '_docs_meta') : 'rag_docs_metadata';
  }, [profileId]);

  // Bug #9 fix: removed duplicate initRAG/initEmbeddingModel calls.
  // ProfileContext handles initialization. We just load local metadata.
  // Bug #12 fix: depend on profileId so it re-runs when profile changes.
  useEffect(() => {
    if (!profileId) return;
    bootstrap();
  }, [profileId]);

  const bootstrap = async () => {
    if (!profileId) return;
    try {
      // RAG + embedding are already initialized by ProfileContext.
      // Just mark as ready and load doc metadata.
      setEmbeddingReady(true);
      setIndexSize(getIndexSize(profileId));
      await loadDocsMeta();
    } catch (err: any) {
      Alert.alert(
        'Embedding Model Not Ready',
        err.message || 'Please download and select an embedding model first.'
      );
    }
  };

  const loadDocsMeta = async () => {
    const key = getDocsMetaKey();
    const raw = await AsyncStorage.getItem(key);
    if (raw) setDocs(JSON.parse(raw));
    else setDocs([]);
  };

  const saveDocsMeta = async (updated: DocMeta[]) => {
    const key = getDocsMetaKey();
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    setDocs(updated);
  };

  const extractText = async (uri: string, name: string): Promise<string> => {
    const lower = name.toLowerCase();

    if (lower.endsWith('.txt')) {
      return await RNFS.readFile(uri, 'utf8');
    }

    if (lower.endsWith('.pdf')) {
      // react-native-pdf-extractor
      const { BaseExtractor } = require('react-native-pdf-extractor');
      await BaseExtractor.setUri(uri);
      const textLines = await BaseExtractor.getText();
      return textLines.join('\n') || '';
    }

    throw new Error(`Unsupported file type: ${name}`);
  };

  const handlePickDocument = async () => {
    if (!embeddingReady) {
      Alert.alert('Not ready', 'Embedding model is not loaded yet.');
      return;
    }

    try {
      const results = await pick({
        type: [types.plainText, types.pdf],
      });

      const { uri, name } = results[0];
      if (!name || !uri) return;

      const docId = `doc_${Date.now()}`;
      setIsIngesting(true);
      setIngestStatus('Reading file...');

      const text = await extractText(uri, name);

      if (!text || text.trim().length < 50) {
        throw new Error('File appears to be empty or too short to index.');
      }

      const { chunkCount } = await ingestTextDoc(text, docId, name, profileId!, {
        onProgress: (stage, done, total) => {
          setIngestStatus(
            total > 1 ? `${stage} ${done}/${total}` : stage
          );
        },
      });

      const newDoc: DocMeta = {
        id: docId,
        name,
        addedAt: new Date().toLocaleString(),
        chunkCount,
      };

      const updated = [newDoc, ...docs];
      await saveDocsMeta(updated);
      setIndexSize(getIndexSize(profileId!));
      setIngestStatus('');
      Alert.alert('Done', `"${name}" indexed with ${chunkCount} chunks.`);
    } catch (err: any) {
      if (isErrorWithCode(err, errorCodes.OPERATION_CANCELED)) return;
      Alert.alert('Error', err.message || 'Failed to ingest document.');
    } finally {
      setIsIngesting(false);
      setIngestStatus('');
    }
  };

  const handleDeleteDoc = (doc: DocMeta) => {
    Alert.alert(
      'Remove Document',
      `Remove "${doc.name}" from the index?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!profileId) return;
            await removeDoc(doc.id, profileId);
            const updated = docs.filter(d => d.id !== doc.id);
            await saveDocsMeta(updated);
            setIndexSize(getIndexSize(profileId));
          },
        },
      ]
    );
  };

  const renderDoc = ({ item }: { item: DocMeta }) => (
    <View style={styles.docItem}>
      <View style={styles.docInfo}>
        <Text style={styles.docName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.docMeta}>
          {item.chunkCount} chunks · {item.addedAt}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDeleteDoc(item)}
      >
        <Text style={styles.deleteText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>DOCUMENTS</Text>
        <Text style={styles.indexInfo}>{indexSize} vectors in index</Text>
      </View>

      {isIngesting ? (
        <View style={styles.ingestingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.ingestStatus}>{ingestStatus}</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={[
              styles.uploadButton,
              !embeddingReady && styles.uploadButtonDisabled,
            ]}
            onPress={handlePickDocument}
            disabled={!embeddingReady}
          >
            <Text style={styles.uploadButtonText}>
              {embeddingReady ? '+ Upload Document' : 'Embedding model not ready'}
            </Text>
          </TouchableOpacity>

          <FlatList
            data={docs}
            renderItem={renderDoc}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No documents indexed yet.</Text>
                <Text style={styles.emptySubText}>
                  Upload a .txt or .pdf file to get started.
                </Text>
              </View>
            }
          />
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
    backgroundColor: '#101626',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'grey',
    fontFamily: 'sans-serif',
  },
  indexInfo: {
    fontSize: 13,
    color: '#8B5CF6',
    marginTop: 4,
    fontFamily: 'sans-serif',
  },
  uploadButton: {
    backgroundColor: '#8B5CF6',
    margin: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  uploadButtonDisabled: {
    backgroundColor: '#374151',
  },
  uploadButtonText: {
    fontSize: 16,
    color: '#F9FAFB',
    fontFamily: 'sans-serif',
    fontWeight: '600',
  },
  ingestingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ingestStatus: {
    marginTop: 16,
    fontSize: 16,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  docItem: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  docInfo: {
    flex: 1,
  },
  docName: {
    fontSize: 15,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
    fontWeight: '600',
  },
  docMeta: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    fontFamily: 'sans-serif',
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  deleteText: {
    fontSize: 13,
    color: '#EF4444',
    fontFamily: 'sans-serif',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    fontSize: 17,
    color: '#9CA3AF',
    fontFamily: 'sans-serif',
  },
  emptySubText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    fontFamily: 'sans-serif',
  },
});

export default DocumentsScreen;