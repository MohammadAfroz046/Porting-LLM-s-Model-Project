import React, { useState, useEffect } from 'react';
import { View, FlatList, Alert, StyleSheet, ActivityIndicator, SafeAreaView} from 'react-native';
import { Button, Card, ProgressBar, Text, IconButton } from 'react-native-paper';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Model = {
  id: string;
  name: string;
  size: number;
  requiredRAM: number;
  downloadUrl: string;
  localPath: string | null;
  isDownloaded: boolean;
  isDownloading: boolean;
  progress: number;
  description: string;
};
import { useProfile } from '../utils/ProfileContext';
import { profileKey } from '../utils/profileManager';

const MODELS_DIR = RNFS.ExternalDirectoryPath + '/models';
// Removed global SELECTED_MODEL_KEY
const EMBEDDING_MODEL_ID = 'all-minilm-l6-v2-q4_k_m';
// Removed global EMBEDDING_MODEL_KEY

const initialModels: Model[] = [
  {
    id: 'tinyllama-1.1b',
    name: 'TinyLlama 1.1B',
    size: 550000000,
    requiredRAM: 2,
    downloadUrl: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Chat, lightweight tasks'
  },
  {
    id: 'stablelm-2-zephyr-1_6b-Q4_K_M',
    name: 'StableLM 2 Zephyr 1.6B (Q4_K_M)',
    size: 1713507840, // ~1.60 GB
    requiredRAM: 4, // Math.ceil(1713507840 / 500000000)
    downloadUrl: 'https://huggingface.co/brittlewis12/stablelm-2-zephyr-1_6b-GGUF/resolve/main/stablelm-2-zephyr-1_6b.Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Chat and reasoning model. Blend of Stability AI’s StableLM and Zephyr fine-tuning.'
  },
  {
    id: 'gemma-2-2b-it-Q4_K_M',
    name: 'Gemma-2-2b-it (Q4_K_M)',
    size: 1434085216, // actual file size in bytes (~1.43 GB)
    requiredRAM: 3, // Math.ceil(1434085216 / 500000000) = 3
    downloadUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Instruction-tuned Gemma 2B for chat, reasoning, and general tasks under low RAM.'
  },
  {
    id: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M',
    name: 'DeepSeek R1 Distill Qwen 1.5B (Q4_K_M)',
    size: 1572134400, // ~1.46 GB
    requiredRAM: 4, // Math.ceil(1572134400 / 500000000)
    downloadUrl: 'https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B.Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Chat & reasoning optimized. Distilled from DeepSeek LLM.'
  },
  {
    id: 'phi-2-Q4_K_M',
    name: 'Phi-2 (Q4_K_M)',
    size: 1426854400, // ~1.33 GB
    requiredRAM: 3, // Math.ceil(1426854400 / 500000000)
    downloadUrl: 'https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'General-purpose reasoning & text. Trained by Microsoft.'
  },
  {
    id: 'deepseek-coder-1.3b-instruct',
    name: 'DeepSeek Coder 1.3B Instruct',
    size: 2600000000, // Approx. for full model, not quantized
    requiredRAM: 6, // Math.ceil(2600000000 / 500000000)
    downloadUrl: 'https://huggingface.co/deepseek-ai/deepseek-coder-1.3b-instruct/resolve/main/model.safetensors',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Code generation and instruction following. Optimized for programming tasks.'
  },
  {
    id: 'OpenGPT-3-Q5_K_S',
    name: 'OpenGPT-3 (Q5_K_S)',
    size: 1711144960, // ~1.59 GB
    requiredRAM: 4, // Math.ceil(1711144960 / 500000000)
    downloadUrl: 'https://huggingface.co/mradermacher/OpenGPT-3-GGUF/resolve/main/OpenGPT-3.Q5_K_S.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Compact GPT-3-style model. Great for general chat and logic.'
  },
  {
    id: 'Phi-3.5-mini-instruct.Q4_K_M',
    name: 'Phi-3.5 mini 4k instruct (Q4_K_M)',
    size: 2393232608,
    requiredRAM: 5, // Math.ceil(2393232608 / 500000000) = 5
    downloadUrl: 'https://huggingface.co/MaziyarPanahi/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct.Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Reasoning (code & math). Multilingual'
  },
  {
    id: 'qwen2.5-1.5b-instruct-q8_0',
    name: 'Qwen2.5-1.5B-Instruct (Q8_0)',
    size: 1894532128,
    requiredRAM: 4, // Math.ceil(1894532128 / 500000000) = 4
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q8_0.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Instruction following, Role-play, Multilingual'
  },
  {
    id: 'qwen2.5-3b-instruct-q5_k_m',
    name: 'Qwen2.5-3B-Instruct (Q5_K_M)',
    size: 2438740384,
    requiredRAM: 5, // Math.ceil(2438740384 / 500000000) = 5
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q5_k_m.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Instructions, Role-play, Multilingual'
  },
  {
    id: 'llama-3.2-1b-instruct-q8_0',
    name: 'Llama-3.2-1b-instruct (Q8_0)',
    size: 1321079200,
    requiredRAM: 3, // Math.ceil(1321079200 / 500000000) = 3
    downloadUrl: 'https://huggingface.co/hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF/resolve/main/llama-3.2-1b-instruct-q8_0.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Instruction following, Summarization, Rewriting'
  },
  {
    id: 'Llama-3.2-3B-Instruct-Q6_K',
    name: 'Llama-3.2-3B-Instruct (Q6_K)',
    size: 2643853856,
    requiredRAM: 6, // Math.ceil(2643853856 / 500000000) = 6
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q6_K.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Instruction following, Summarization, Rewriting'
  },
  {
    id: 'all-minilm-l6-v2-q4_k_m',
    name: 'all-MiniLM-L6-v2 (Embedding Model)',
    size: 45000000,
    requiredRAM: 1,
    downloadUrl: 'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-Q4_K_M.gguf',
    localPath: null,
    isDownloaded: false,
    isDownloading: false,
    progress: 0,
    description: 'Required for document search (RAG). Semantic embedding model. Download this to use the Documents feature.',
  },
];
const ModelsScreen = ({ navigation }: { navigation: any }) => {
  const [models, setModels] = useState<Model[]>(initialModels);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDownload, setActiveDownload] = useState<string | null>(null);
  const abortControllers = React.useRef(new Map<string, AbortController>());
  const { profileId } = useProfile();

  const SELECTED_MODEL_KEY = profileId ? profileKey(profileId, '_selected_model') : 'selected_model';
  const EMBEDDING_MODEL_KEY = profileId ? profileKey(profileId, '_embedding_model') : 'embedding_model_id';

  // Load saved models and selection
  useEffect(() => {
    const loadModels = async () => {
      try {
        await RNFS.mkdir(MODELS_DIR);
        const [savedModels, savedSelected] = await Promise.all([
          AsyncStorage.getItem('models'),
          AsyncStorage.getItem(SELECTED_MODEL_KEY)
        ]);

        const modelList = savedModels ? JSON.parse(savedModels) : initialModels;
        const verifiedModels = await verifyModelFiles(modelList);

        setModels(verifiedModels);
        setSelectedModelId(savedSelected);
      } catch (error) {
        Alert.alert('Error', 'Failed to load models');
      } finally {
        setIsLoading(false);
      }
    };

    loadModels();

    // Cleanup on component unmount
    return () => {
      abortControllers.current.forEach(controller => controller.abort());
      abortControllers.current.clear();
    };
  }, []);

  const verifyModelFiles = async (modelList: Model[]) => {
    return Promise.all(modelList.map(async model => ({
      ...model,
      isDownloaded: model.localPath ? await RNFS.exists(model.localPath) : false
    })));
  };

  const saveModels = async (updatedModels: Model[]) => {
    await AsyncStorage.setItem('models', JSON.stringify(updatedModels));
  };

  const handleDownloadError = async (modelId: string) => {
    const model = models.find(m => m.id === modelId)!;
    if (model.localPath) {
      try {
        await RNFS.unlink(model.localPath);
      } catch (err) {
        console.error('Failed to delete partial download:', err);
      }
    }
    setModels(prev => prev.map(m =>
      m.id === modelId ? { ...m, isDownloading: false, progress: 0, localPath: null } : m
    ));
    setActiveDownload(null);
    abortControllers.current.delete(modelId);
    Alert.alert('Error', 'Download failed or was interrupted');
  };

  const handleDownload = async (modelId: string) => {
    if (activeDownload) {
      
      return;
    }

    setActiveDownload(modelId);
    setModels(prev => prev.map(m =>
      m.id === modelId ? { ...m, isDownloading: true, progress: 0 } : m
    ));

    try {
      const model = models.find(m => m.id === modelId)!;
      const localPath = `${MODELS_DIR}/${modelId}.gguf`;
      const controller = new AbortController();
      abortControllers.current.set(modelId, controller);

      await RNFS.downloadFile({
        fromUrl: model.downloadUrl,
        toFile: localPath,
        progress: res => {
          const progress = Math.floor((res.bytesWritten / res.contentLength) * 100);
          setModels(prev => prev.map(m =>
            m.id === modelId ? { ...m, progress } : m
          ));
        },
        progressDivider: 1,
        begin: () => {
          console.log('Download started for:', modelId);
        },
        connectionTimeout: 30000,
        readTimeout: 30000,
        background: true,
        cacheable: false,
        signal: controller.signal
      }).promise;

      const updatedModels = models.map(m =>
        m.id === modelId ? {
          ...m,
          isDownloaded: true,
          isDownloading: false,
          localPath,
          progress: 100
        } : m
      );

      setModels(updatedModels);
      await saveModels(updatedModels);
      setActiveDownload(null);
      abortControllers.current.delete(modelId);
    } catch (error: any) {
      if (error.code === 'E_ABORTED') {
        console.log('Download aborted for:', modelId);
      }
      await handleDownloadError(modelId);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      const model = models.find(m => m.id === modelId)!;
      if (model.localPath) await RNFS.unlink(model.localPath);

      const updatedModels = models.map(m =>
        m.id === modelId ? {
          ...m,
          isDownloaded: false,
          localPath: null
        } : m
      );

      setModels(updatedModels);
      await saveModels(updatedModels);

      if (selectedModelId === modelId) {
        await AsyncStorage.removeItem(SELECTED_MODEL_KEY);
        setSelectedModelId(null);
      }
    } catch (error: any) {
      Alert.alert('Error', 'Failed to delete model');
    }
  };

  const selectModel = async (modelId: string) => {
    setSelectedModelId(modelId);
    await AsyncStorage.setItem(SELECTED_MODEL_KEY, modelId);

    if (modelId === EMBEDDING_MODEL_ID) {
      await AsyncStorage.setItem(EMBEDDING_MODEL_KEY, modelId);
      Alert.alert('Embedding Model Selected', 'This model will be used for document search (RAG).');
      return;
    }

    navigation.navigate('Chat', { selectedModelId: modelId });
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={styles.loadingText}>Loading models...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MODELS</Text>
      </View>
      <FlatList
        data={models}
        renderItem={({ item }) => (
          <Card style={[
            styles.card,
            selectedModelId === item.id && styles.selectedCard
          ]}>
            <Card.Title
              title={item.name}
              titleStyle={styles.cardTitle}
              subtitle={`${(item.size / 1024 / 1024).toFixed(2)}MB | ${item.requiredRAM}GB RAM${item.id === EMBEDDING_MODEL_ID ? ' · EMBEDDING' : ''}`}
              subtitleStyle={styles.cardSubtitle}
              right={() => selectedModelId === item.id && (
                <IconButton icon="check" iconColor="#8B5CF6" size={24} />
              )}
            />
            <Card.Content>
              <Text style={styles.description}>{item.description}</Text>
            </Card.Content>
            <Card.Content>
              {item.isDownloading && (
                <>
                  <ProgressBar
                    progress={item.progress / 100}
                    color="#8B5CF6"
                  />
                  <Text style={styles.progressText}>{item.progress.toFixed(0)}%</Text>
                </>
              )}
            </Card.Content>
            <Card.Actions style={styles.cardActions}>
              {item.isDownloaded ? (
                <>
                  <Button
                    mode="outlined"
                    onPress={() => handleDelete(item.id)}
                    style={styles.button}
                    labelStyle={styles.buttonLabel}
                    disabled={false}
                  >
                    Delete
                  </Button>
                  <Button
                    mode="contained"
                    onPress={() => selectModel(item.id)}
                    style={styles.button}
                    labelStyle={styles.buttonLabel}
                    disabled={false}
                  >
                    {selectedModelId === item.id ? 'Selected' : 'Select'}
                  </Button>
                </>
              ) : (
                <Button
                  mode="contained"
                  onPress={() => handleDownload(item.id)}
                  loading={item.isDownloading}
                  style={styles.button}
                  labelStyle={styles.buttonLabel}
                  disabled={item.isDownloading || !!activeDownload}
                >
                  Download
                </Button>
              )}
            </Card.Actions>
          </Card>
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
      />
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'grey',
    fontFamily: 'sans-serif',
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    marginBottom: 16,
    borderRadius: 12,
  },
  selectedCard: {
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  cardTitle: {
    fontSize: 16,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    fontFamily: 'sans-serif',
  },
  description: {
    fontSize: 14,
    color: '#9CA3AF',
    fontFamily: 'sans-serif',
    marginTop: 4,
  },
  progressText: {
    fontSize: 14,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
    marginTop: 4,
  },
  button: {
    marginLeft: 8,
    borderRadius: 24,
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  buttonLabel: {
    fontSize: 14,
    color: '#F9FAFB',
    fontFamily: 'sans-serif',
  },
  cardActions: {
    justifyContent: 'flex-end',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F19',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 17,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
  },
});

export default ModelsScreen;