import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../utils/ProfileContext';

const Setting1 = ({ navigation }: { navigation: any }) => {
  const { logout } = useProfile();

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <TouchableOpacity
        style={styles.modelCard}
        onPress={async () => {
          await logout();
          // Navigation to ProfileSelect happens automatically via App.tsx conditional rendering
        }}
      >
        <Text style={styles.modelName}>Switch Profile</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

export default Setting1;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B030F',
    padding: 20,
  },
  title: {
    fontSize: 24,
    color: '#fbd85d',
    fontWeight: 'bold',
    marginBottom: 20,
  },
  modelCard: {
    backgroundColor: '#1A1A2E',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: 'center',
  },
  modelName: {
    color: '#ffffff',
    fontSize: 18,
  },
});
