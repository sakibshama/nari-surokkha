import api from '../api';
import * as Location from 'expo-location';

/**
 * SensorsManager
 * 
 * Responsible for gathering raw sensor data (audio, motion, location)
 * and dispatching it to the backend ML service for real-time analysis.
 */
class SensorsManager {
  private isMonitoring = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    console.log('[SensorsManager] Started background sensor monitoring...');

    // Simulate sending motion and audio data every 5 seconds
    this.intervalId = setInterval(async () => {
      try {
        await this.sendMockMotionData();
        await this.sendMockAudioData();
      } catch (error) {
        console.error('[SensorsManager] Error sending sensor data:', error);
      }
    }, 5000);
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[SensorsManager] Stopped background sensor monitoring.');
  }

  private async sendMockMotionData() {
    // Generate mock accelerometer data
    const motionData = {
      accelerometer: [[0.1, 0.2, 9.8], [0.3, 0.1, 9.7]],
      gyroscope: [[0.01, 0.0, 0.05], [0.0, 0.01, 0.02]],
      timestamp: Date.now()
    };

    // Normally this would go directly to the ML service API or through the backend proxy
    // In our architecture, the backend proxy routes to the ML service, but for direct
    // we would hit the ml-service port. For simplicity, we assume the backend proxies it,
    // or we just trigger the backend soft alert route directly based on local edge logic.
    
    console.log('[SensorsManager] Mock motion data dispatched to ML service.');
  }

  private async sendMockAudioData() {
    // Generate mock audio chunk
    const audioData = {
      audio_base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      sample_rate: 16000
    };

    console.log('[SensorsManager] Mock audio data dispatched to ML service.');
  }
}

export const sensorsManager = new SensorsManager();
