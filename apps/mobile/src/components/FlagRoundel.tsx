/**
 * Bangladesh flag roundel — bottle-green field with the red disc offset
 * slightly toward the hoist, as on the national flag. Pure Views, no assets.
 */
import React from 'react';
import { View } from 'react-native';

export default function FlagRoundel({ size = 30 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: '#006a4e',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
      }}
    >
      <View
        style={{
          width: size * 0.46,
          height: size * 0.46,
          borderRadius: size * 0.23,
          backgroundColor: '#f42a41',
          marginRight: size * 0.08,
        }}
      />
    </View>
  );
}
