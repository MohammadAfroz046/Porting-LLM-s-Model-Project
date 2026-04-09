
import React, { useState, useEffect, useRef } from 'react';
import { Image, Modal, TouchableOpacity as RNTouchableOpacity } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import LinearGradient from 'react-native-linear-gradient';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  LogBox,
} from 'react-native';
import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { retrieveContext } from '../utils/rag/ragPipeline';
import { initEmbeddingModel } from '../utils/rag/embedder';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AudioWaveform from './audiowaveformCode';
import { routeTask } from '../utils/taskRouter';
import { useProfile } from '../utils/ProfileContext';
import { profileKey } from '../utils/profileManager';

// Use platform-specific paths for MODELS_DIR
const MODELS_DIR = RNFS.ExternalDirectoryPath + '/models';

// Keys generated dynamically below using profileKey

const getCurrentTime = () => {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getCurrentDateTime = () => {
  const now = new Date();
  return now.toLocaleString();
};

type Message = {
  text: string;
  type: 'user' | 'bot' | 'loading';
  time: string;
  responseTime?: string;
};

type Task = {
  id: string;
  input: string;
  taskType: string;
  dateTime: string;
};

const ChatScreen = ({ navigation, route }: { navigation: any; route: any }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [context, setContext] = useState<LlamaContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [modelStatus, setModelStatus] = useState('Loading...');
  const [currentModel, setCurrentModel] = useState('');
  const [errorCount, setErrorCount] = useState(0);
  const [modelError, setModelError] = useState<string | null>(null);
  const [taskHistory, setTaskHistory] = useState<Task[]>([]);
  const [isHistoryModalVisible, setIsHistoryModalVisible] = useState(false);
  const modelId = route.params?.selectedModelId;
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Bug #11 fix: use a ref to hold context so cleanup always has the current value
  const contextRef = useRef<LlamaContext | null>(null);
  const { profileId } = useProfile();

  // Bug #16 fix: guard against null profileId in key generation
  const SELECTED_MODEL_KEY = profileId ? profileKey(profileId, '_selected_model') : '';
  const TASK_HISTORY_KEY = profileId ? profileKey(profileId, '_task_history') : '';
  const CHAT_MESSAGES_KEY = profileId ? profileKey(profileId, '_chat_messages') : '';

  useEffect(() => {
    LogBox.ignoreLogs(['new NativeEventEmitter']);
  }, []);

  useEffect(() => {
    const initializeModel = async () => {
      try {
        // Use the model ID from params if available, otherwise check AsyncStorage
        let selectedModelId = modelId || (await AsyncStorage.getItem(SELECTED_MODEL_KEY));
        if (!selectedModelId) {
          throw new Error('No model selected. Please select a model to start chatting.');
        }

        const modelPath = `${MODELS_DIR}/${selectedModelId}.gguf`;
        const exists = await RNFS.exists(modelPath).catch((err) => {
          console.error('RNFS.exists error:', err);
          return false;
        });
        if (!exists) {
          throw new Error(`The selected model could not be found. Please download a model to continue.`);
        }

        setModelStatus(`Loading ${selectedModelId}...`);
        setCurrentModel(selectedModelId);

        const llamaContext = await initLlama({
          model: `file://${modelPath}`,
          n_ctx: 512,
          n_gpu_layers: 0,
          n_threads: 4,
        }).catch((err) => {
          throw new Error(`Failed to initialize the model. Please try again or select a different model.`);
        });

        if (!llamaContext) {
          throw new Error('Model initialization failed. Please try again.');
        }
        // Bug #11 fix: keep ref in sync for cleanup
        contextRef.current = llamaContext;
        setContext(llamaContext);
        setModelStatus(`Model loaded: ${selectedModelId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setModelStatus(`Error: ${errorMessage}`);
        setModelError(errorMessage);
        setErrorCount((prev) => prev + 1);
        console.error('Model initialization error:', errorMessage);
      }
    };

    const loadTaskHistory = async () => {
      try {
        const history = await AsyncStorage.getItem(TASK_HISTORY_KEY);
        if (history) {
          setTaskHistory(JSON.parse(history));
        }
      } catch (error) {
        console.error('Error loading task history:', error);
      }
    };

    const loadChatHistory = async () => {
      try {
        const chatData = await AsyncStorage.getItem(CHAT_MESSAGES_KEY);
        if (chatData) setMessages(JSON.parse(chatData));
      } catch (error) {
        console.error('Error loading chat history:', error);
      }
    };

    initializeModel();
    loadTaskHistory();
    loadChatHistory();

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      // Bug #11 fix: use contextRef instead of stale closure over context state
      if (contextRef.current) {
        try {
          contextRef.current.release();
          contextRef.current = null;
          setContext(null);
        } catch (releaseError) {
          console.error('Error releasing context:', releaseError);
        }
      }
    };
  }, [modelId]);

  const LoadingDots = () => {
    const [dots, setDots] = useState('');

    useEffect(() => {
      const interval = setInterval(() => {
        setDots((prev) => (prev.length < 3 ? prev + '.' : ''));
      }, 400);
      return () => clearInterval(interval);
    }, []);

    return <Text style={styles.loadingText}>Generating{dots}</Text>;
  };

  const saveTaskToHistory = async (input: string, taskType: string) => {
    try {
      const newTask: Task = {
        id: Math.random().toString(36).substr(2, 9),
        input,
        taskType,
        dateTime: getCurrentDateTime(),
      };
      const updatedHistory = [newTask, ...taskHistory];
      setTaskHistory(updatedHistory);
      await AsyncStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(updatedHistory));
    } catch (error) {
      console.error('Error saving task to history:', error);
    }
  };

  const clearTaskHistory = async () => {
    try {
      setTaskHistory([]);
      await AsyncStorage.setItem(TASK_HISTORY_KEY, JSON.stringify([]));
    } catch (error) {
      console.error('Error clearing task history:', error);
      Alert.alert('Error', 'Failed to clear task history');
    }
  };

  const displayWordByWord = (response: string, startTime: number) => {
    const words = response.split(' ');
    let currentIndex = 0;

    const typeNextWord = () => {
      if (currentIndex >= words.length) {
        const responseDuration = ((Date.now() - startTime) / 1000).toFixed(2) + 's';
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last) last.responseTime = responseDuration;
          return updated;
        });
        setIsLoading(false);
        typingTimeoutRef.current = null;
        return;
      }

      const partial = words.slice(0, currentIndex + 1).join(' ');
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          text: partial,
          type: 'bot',
          time: getCurrentTime(),
        };
        AsyncStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(updated)).catch(console.error);
        return updated;
      });

      currentIndex++;
      typingTimeoutRef.current = setTimeout(typeNextWord, 60 + Math.random() * 40);
    };

    typeNextWord();
  };

  const handleStopGeneration = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.type === 'loading') {
        updated.pop(); // Remove loading message if no response yet
      } else if (last?.type === 'bot') {
        // Keep the partial response as is
      }
      return updated;
    });
    setIsLoading(false);
  };

  const handleSend = async () => {
    if (!inputText.trim() || !context || isLoading || isListening) return;

    const userMessage = {
      text: inputText.trim(),
      type: 'user' as const,
      time: getCurrentTime(),
    };

    // Bug #10 fix: single atomic setMessages call instead of two separate pushes
    setInputText('');
    setIsLoading(true);

    setMessages((prev) => {
      const updated = [...prev, userMessage, { text: '...', type: 'loading' as const, time: getCurrentTime() }];
      AsyncStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(updated)).catch(console.error);
      return updated;
    });

    try {
      const startTime = Date.now();
      
      let finalPrompt = userMessage.text;
      try {
        if (profileId) {
          // Embedding model is initialized by ProfileContext — no duplicate init needed
          const contextText = await retrieveContext(userMessage.text, profileId);
          if (contextText) {
            finalPrompt = `Use the following context to answer:\n\n${contextText}\n\nUser: ${userMessage.text}`;
          }
        }
      } catch (err) {
        console.warn('RAG retrieval failed in ChatScreen:', err);
      }

      const response = await routeTask(finalPrompt, context, saveTaskToHistory);

      if (!response || typeof response !== 'string') {
        throw new Error('Invalid response from routeTask');
      }

      displayWordByWord(response, startTime);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Send error:', errorMessage);
      setErrorCount((prev) => prev + 1);

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];

        if (last?.type === 'loading') {
          updated[updated.length - 1] = {
            text: `❌ Error: ${errorMessage}`,
            type: 'bot',
            time: getCurrentTime(),
          };
        } else {
          updated.push({
            text: `❌ Error: ${errorMessage}`,
            type: 'bot',
            time: getCurrentTime(),
          });
        }

        return updated;
      });

      Alert.alert('Error', `Failed to generate response: ${errorMessage}`);
      setIsLoading(false);
    }
  };

  const startListening = () => {
    if (isLoading || !context) {
      console.warn('Cannot start listening: Loading or no context');
      return;
    }
    setIsListening(true);
  };

  const stopListening = () => {
    setIsListening(false);
    setInputText('Transcribed text');
  };

  const cancelListening = () => {
    setIsListening(false);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View
      style={[
        styles.messageContainer,
        item.type === 'user'
          ? styles.userMessage
          : item.type === 'loading'
            ? styles.loadingMessage
            : styles.botMessage,
      ]}
    >
      <View style={styles.messageRow}>
        {item.type === 'bot' && (
          <Image
            source={require('./logo.png')}
            style={styles.botIcon}
          />
        )}
        <View style={styles.textContainer}>
          {item.type === 'loading' ? (
            <LoadingDots />
          ) : (
            <Text style={styles.messageText}>{item.text}</Text>
          )}
        </View>
      </View>
      <View style={styles.messageTime}>
        <Text style={styles.messageTimeText}>{item.time}</Text>
        {item.responseTime && (
          <Text style={styles.responseTime}> · {item.responseTime}</Text>
        )}
      </View>
    </View>
  );

  const renderTask = ({ item }: { item: Task }) => (
    <View style={styles.taskItem}>
      <Text style={styles.taskType}>{item.taskType}</Text>
      <Text style={styles.taskText}>{item.input}</Text>
      <Text style={styles.taskDateTime}>{item.dateTime}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {currentModel && (
          <RNTouchableOpacity
            style={styles.modelContainer}
            onPress={() => {
              try {
                navigation.navigate('Models');
              } catch (navError) {
                console.error('Navigation error:', navError);
                Alert.alert('Navigation Error', 'Failed to navigate to Models screen');
              }
            }}
          >
            <Text style={styles.modelName}>{currentModel}</Text>
            <Icon name="arrow-drop-down" size={24} color="grey" />
          </RNTouchableOpacity>
        )}
        <RNTouchableOpacity
          style={styles.rightButton}
          onPress={() => setIsHistoryModalVisible(true)}
        >
          <Image
            source={require('../assets/list.png')}
            style={[styles.iconImage, { tintColor: 'white' }]}
          />
        </RNTouchableOpacity>
      </View>

      {!context && !modelError ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6200EE" />
          <Text style={styles.loadingText}>{modelStatus}</Text>
        </View>
      ) : !context && modelError ? (
        <View style={styles.welcomeContainer}>
          <Text style={styles.errorText}>{modelError}</Text>
          <RNTouchableOpacity
            style={styles.selectModelButton}
            onPress={() => navigation.navigate('Models')}
          >
            <Text style={styles.selectModelButtonText}>Go to Models Screen</Text>
          </RNTouchableOpacity>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.welcomeContainer}>
          <MaskedView

            maskElement={
              <View style={styles.maskContainer}>
                <Text style={[styles.welcomeText, { backgroundColor: 'transparent' }]}>
                  How may I help you?
                </Text>
              </View>
            }
          >
            <LinearGradient
              colors={['rgba(232, 74, 127, 1)', 'rgba(122, 95, 255, 1)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={[styles.welcomeText, { opacity: 0 }]}>
                How may I help you?
              </Text>
            </LinearGradient>
          </MaskedView>
        </View>
      ) : (
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(_, index) => index.toString()}
          contentContainerStyle={styles.messagesContainer}
        />
      )
      }

      <Modal
        animationType="slide"
        transparent={true}
        visible={isHistoryModalVisible}
        onRequestClose={() => setIsHistoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Task History</Text>
              <RNTouchableOpacity
                style={styles.clearButton}
                onPress={clearTaskHistory}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </RNTouchableOpacity>
              <RNTouchableOpacity onPress={() => setIsHistoryModalVisible(false)}>
                <Icon name="close" size={24} color="#fff" />
              </RNTouchableOpacity>
            </View>
            <FlatList
              data={taskHistory}
              renderItem={renderTask}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.taskList}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No tasks yet</Text>
              }
            />
          </View>
        </View>
      </Modal>

      {
        isListening && (
          <View style={styles.listeningContainer}>
            <AudioWaveform />
            <Text style={styles.listeningText}>🎙️ Listening...</Text>
            <View style={styles.controls}>
              <RNTouchableOpacity onPress={stopListening} style={styles.controlButton}>
                <Icon name="check-circle" size={28} color="#fff" />
              </RNTouchableOpacity>
              <RNTouchableOpacity onPress={cancelListening} style={styles.controlButton}>
                <Icon name="cancel" size={28} color="#fff" />
              </RNTouchableOpacity>
            </View>
          </View>
        )
      }

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type your message..."
            placeholderTextColor="#888"
            editable={!!context && !isLoading && !isListening}
            multiline
          />
          <View style={styles.buttonContainer}>
            {isLoading ? (
              <RNTouchableOpacity
                style={styles.iconButton}
                onPress={handleStopGeneration}
                onPressIn={() => console.log('Stop button pressed')}
              >
                <Icon name="stop" size={24} color="#888" />
              </RNTouchableOpacity>
            ) : (
              <RNTouchableOpacity
                style={styles.iconButton}
                onPress={handleSend}
                disabled={!context || isLoading || isListening}
                onPressIn={() => console.log('Send button pressed')}
              >
                <Icon
                  name="send"
                  size={24}
                  color={!context || isLoading || isListening ? '#aaa' : '#888'}
                />
              </RNTouchableOpacity>
            )}
            <RNTouchableOpacity
              style={styles.iconButton}
              onPress={startListening}
              disabled={!context || isLoading || isListening}
              onPressIn={() => console.log('Mic button pressed')}
            >
              <Icon
                name="mic"
                size={24}
                color={!context || isLoading || isListening ? '#aaa' : '#888'}
              />
            </RNTouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View >
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modelContainer: {
    alignItems: 'center',
  },
  modelName: {
    fontSize: 15.5,
    paddingTop: 7,
    color: '#9CA3AF',
    fontFamily: 'sans-serif',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 17,
    color: '#FFFFFF',
    fontFamily: 'sans-serif',
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  maskContainer: {
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  rightButton: {
    padding: 8,
  },
  iconImage: {
    width: 23.5,
    height: 23.5,
    right: -132,
    resizeMode: 'contain',
    opacity: 0.7,
  },
  welcomeText: {
    fontSize: 24,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
  },
  errorText: {
    fontSize: 18,
    color: '#FF6F91',
    fontFamily: 'sans-serif',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  selectModelButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },
  selectModelButtonText: {
    fontSize: 16,
    color: '#F9FAFB',
    fontFamily: 'sans-serif',
  },
  messagesContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 100,
  },
  messageContainer: {
    marginBottom: 14,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#7F15EA',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    borderBottomRightRadius: 0,
    maxWidth: '80%',
  },
  botMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    maxWidth: '90%',
  },
  loadingMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderBottomLeftRadius: 0,
    maxWidth: '80%',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  textContainer: {
    flexShrink: 1,
  },
  messageText: {
    fontSize: 15,
    color: '#E5E7EB',
    lineHeight: 24,
    fontFamily: 'sans-serif',
  },
  messageTime: {
    flexDirection: 'row',
    marginTop: 4,
    marginLeft: 24,
  },
  messageTimeText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: 'sans-serif',
  },
  responseTime: {
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: 'sans-serif',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 58,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 14,
    marginVertical: 12,
  },
  input: {
    flex: 1,
    minHeight: 50,
    maxHeight: 130,
    fontSize: 17,
    color: '#F9FAFB',
    fontFamily: 'sans-serif',
    paddingVertical: 14,
    paddingRight: 80,
  },
  buttonContainer: {
    flexDirection: 'row',
    position: 'absolute',
    right: 10,
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#888',
    backgroundColor: '#1F2937',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  listeningContainer: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  listeningText: {
    marginTop: 10,
    fontSize: 17,
    color: '#8B5CF6',
    fontWeight: '500',
    fontFamily: 'Inter',
  },
  controls: {
    flexDirection: 'row',
    marginTop: 16,
  },
  controlButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 8,
  },
  botIcon: {
    width: 18,
    height: 18,
    marginRight: 6,
    resizeMode: 'contain',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    width: '90%',
    maxHeight: '50%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
  },
  taskList: {
    paddingBottom: 16,
  },
  taskItem: {
    backgroundColor: '#2D3748',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  taskType: {
    fontSize: 14,
    color: '#8B5CF6',
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
    marginBottom: 4,
  },
  taskText: {
    fontSize: 16,
    color: '#E5E7EB',
    fontFamily: 'sans-serif',
  },
  taskDateTime: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
    fontFamily: 'sans-serif',
  },
  emptyText: {
    fontSize: 16,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
    fontFamily: 'sans-serif',
  },
  clearButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginRight: 10,
  },
  clearButtonText: {
    fontSize: 17,
    color: '#ff6363',
    fontFamily: 'sans-serif',
    fontWeight: '600',
  },
});

export default ChatScreen;
