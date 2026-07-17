import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface StreamingViewProps {
  isActive: boolean;
  onStopStreaming?: () => void;
}

/**
 * StreamingView Placeholder
 * 
 * Future WebRTC integration for live audio/video streaming to dispatch.
 */
export const StreamingView: React.FC<StreamingViewProps> = ({ isActive, onStopStreaming }) => {
  if (!isActive) return null;

  return (
    <View style={styles.container}>
      <View style={styles.cameraPlaceholder}>
        <Text style={styles.recordingText}>🔴 LIVE BROADCASTING</Text>
        <Text style={styles.subText}>Secure WebRTC Stream to Dispatch</Text>
      </View>
      <TouchableOpacity style={styles.stopButton} onPress={onStopStreaming}>
        <Text style={styles.stopButtonText}>END STREAM</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 20,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraPlaceholder: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  recordingText: {
    color: '#ff4444',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subText: {
    color: '#aaa',
    fontSize: 14,
  },
  stopButton: {
    backgroundColor: '#333',
    padding: 15,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
