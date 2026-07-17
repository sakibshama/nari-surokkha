# ML Battery Usage & Optimization Guide

Integrating Machine Learning on edge devices (smartphones) poses significant battery drain risks, especially when continuously polling sensors or microphone hardware. This document outlines the strategies Nari Surokkha uses to balance continuous safety monitoring with acceptable battery life.

## The Challenge
1. **Accelerometer/Gyroscope:** Polling the IMU (Inertial Measurement Unit) at 50Hz+ prevents the CPU from sleeping.
2. **Audio Processing:** Continuously recording audio and computing MFCCs (Mel-Frequency Cepstral Coefficients) is highly CPU intensive.
3. **Inference:** Running TensorFlow Lite models frequently drains the battery.

## Current Architecture (Phase 16)
Currently, the system uses **Sliding Windows** with simulated TFLite model execution:
- `SensorProcessor`: Runs every 2 seconds.
- `AudioProcessor`: Runs every 3 seconds.

## Optimization Strategies for Production

### 1. Hardware-Backed Wakeup Triggers (Tier 1)
Instead of continuous polling by the CPU, we must offload detection to low-power hardware coprocessors.
- **Android `TYPE_SIGNIFICANT_MOTION`**: A low-power hardware sensor that wakes the CPU only when a significant movement is detected.
- **iOS `CMMotionActivityManager`**: Uses the M-series coprocessor to classify motion states efficiently.
*Actionable Rule:* Only activate the `SensorProcessor`'s high-frequency windowing when a significant motion hardware interrupt fires.

### 2. Audio Wake-Word Engines
Continuous microphone access is a massive drain and a privacy concern. 
- We must use a low-power "wake-word" engine (like Snowboy or Porcupine) to listen for a specific distress trigger word (e.g., "Help", "Surokkha").
- Only if the wake-word is triggered should the full `AudioDistressModel` be activated to capture context or confirm the emergency.

### 3. Model Quantization
- Ensure all TFLite models are fully INT8 quantized. 
- Avoid float32 models on mobile to leverage mobile neural processing units (NPUs) or Hexagon DSPs.

### 4. Backoff Mechanisms
- If the phone is stationary on a desk (detected via 0 hardware interrupts for 5 minutes), reduce polling intervals drastically or shut down ML inference entirely until picked up.

## Implementation Roadmap
- **Phase 16 (MVP):** Simulated continuous windowing (high battery drain, acceptable for alpha testing).
- **Phase 18+:** Integrate React Native background processing libraries that tap into hardware significant-motion events and wake-word engines.
